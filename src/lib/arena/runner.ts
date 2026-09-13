import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, appendFileSync } from "node:fs";
import path from "node:path";
import pLimit from "p-limit";
import { getMatch, createRun, updateRun, updateMatch, listRuns } from "@/lib/db";
import { adapters } from "./adapters/registry";
import { computeCostUsd } from "./pricing";
import { emit } from "./bus";
import { seedWorkdir } from "./seed";
import { verifyFix } from "./verify";
import { killTree } from "./proc";
import { workdirRoot } from "./paths";
import type { ArenaEvent, Combo } from "./types";

const CONCURRENCY = Number(process.env.ARENA_CONCURRENCY ?? 3);
const TIMEOUT_MS = Number(process.env.ARENA_TIMEOUT_MS ?? 15 * 60 * 1000);
const VERIFY_TIMEOUT_MS = Number(process.env.ARENA_VERIFY_TIMEOUT_MS ?? 5 * 60 * 1000);
// 连续 N 次网络类错误（Reconnecting/Connection failed 等）自动停止该 agent
const NET_ERR_LIMIT = Number(process.env.ARENA_NET_ERR_LIMIT ?? 3);
const NET_ERR_RE = /reconnecting|connection failed|error sending request|econn(refused|reset|aborted)|etimedout|enotfound|fetch failed|socket hang up|network (error|issue)/i;
// stderr 行分类：命中错误特征的行升级为 error（UI 红色上屏），其余是 CLI 调试/日志噪音（如 codex 时间戳 INFO 行、claude 调试行），仅留档与网络错误检测，UI 不展示
const STDERR_ERR_RE = /\b(error|failed|fatal|panic|exception|unauthorized|forbidden|invalid|refused|timed out|timeout|rate.?limit|quota|econn|disconnect)/i;

// 运行中子进程登记：支持用户手动停止
const activeChildren = new Map<string, ChildProcess>();
const manualStops = new Set<string>();

/** 手动停止指定 run：杀进程树，close 后按 failed 落库（error=用户手动停止）。未在运行返回 false */
export function stopRun(runId: string): boolean {
  const child = activeChildren.get(runId);
  if (!child?.pid) return false;
  manualStops.add(runId);
  killTree(child.pid);
  return true;
}

async function executeRun(matchId: string, prompt: string, combo: Combo, runId: string, sourceDir?: string | null) {
  const adapter = adapters[combo.harness];
  const dir = path.join(workdirRoot(), matchId, runId);
  mkdirSync(dir, { recursive: true });
  createRun({ id: runId, matchId, harness: combo.harness, model: combo.model, workdir: dir });
  updateRun(runId, { status: "running", startedAt: new Date() });
  emit({ channel: "run-status", matchId, runId, status: "running" });

  const trajPath = path.join(dir, "trajectory.jsonl");
  const writeTraj = (ev: ArenaEvent) => appendFileSync(trajPath, JSON.stringify(ev) + "\n");
  let doneEmitted = false;
  // 网络错误连续计数与停止原因（手动/自动）；真实进展会重置计数
  let netErrStreak = 0;
  let stopReason: string | null = null;

  const handleEvents = (events: ArenaEvent[]) => {
    for (const ev of events) {
      if (ev.kind === "done") doneEmitted = true;
      writeTraj(ev);
      emit({ channel: "run-event", matchId, runId, event: ev });
      if (ev.kind === "done" && ev.usage) {
        // 成本统一按 tokens × 单价核算（CLI 自报成本对自定义供应商不可信，见 pricing.ts）
        const cost = computeCostUsd(combo.model, ev.usage);
        ev.costUsd = cost ?? undefined;
        updateRun(runId, { tokensIn: ev.usage.input, tokensOut: ev.usage.output, costUsd: cost ?? null });
      }
      // 网络错误检测：system/error 事件命中网络类关键词则计数，其余事件视为进展重置
      if (ev.kind === "system" || ev.kind === "error") {
        if (NET_ERR_RE.test(ev.text)) {
          netErrStreak += 1;
          if (netErrStreak >= NET_ERR_LIMIT && !stopReason) {
            stopReason = `连续 ${netErrStreak} 次网络错误（Reconnecting/Connection failed），已自动停止`;
            handleEvents([{ kind: "system", text: stopReason, ts: Date.now() }]);
            const child = activeChildren.get(runId);
            if (child?.pid) killTree(child.pid);
          }
        }
      } else {
        netErrStreak = 0;
      }
    }
  };

  const fake = process.env[`ARENA_FAKE_CMD_${combo.harness}`] ?? process.env.ARENA_FAKE_CMD;
  let file: string, args: string[], stdin: string | undefined, shell: boolean;
  if (fake) {
    const parts = fake.split(" ");
    file = parts[0]; args = parts.slice(1); stdin = undefined; shell = true;
  } else {
    const cmd = adapter.buildCommand(combo, dir, prompt);
    file = cmd.file; args = cmd.args;
    stdin = cmd.stdin === "__PROMPT__" ? prompt : cmd.stdin;
    shell = cmd.shell ?? true;
    if (file === "claude") stdin = prompt; // claude -p 从 stdin 读 prompt
  }

  const parser = adapter.createParser();
  const started = Date.now();
  let finalStatus: "completed" | "failed" | "timeout" | null = null;

  // 题目项目预置：把源目录复制进本运行的独立工作目录（各 agent 拿同一道题的独立副本，隔离修改）
  if (sourceDir) {
    try {
      seedWorkdir(dir, sourceDir);
    } catch (err) {
      updateRun(runId, { status: "failed", error: `题目复制失败: ${String(err)}`, finishedAt: new Date(), durationMs: Date.now() - started });
      emit({ channel: "run-status", matchId, runId, status: "failed", error: String(err) });
      return;
    }
  }

  let timedOut = false;

  await new Promise<void>((resolve) => {
    const child = spawn(file, args, { cwd: dir, shell, env: { ...process.env } });
    activeChildren.set(runId, child);
    const timer = setTimeout(() => { timedOut = true; killTree(child.pid!); }, TIMEOUT_MS);
    const handleLine = (line: string) => {
      if (!line.trim()) return;
      const events = fake ? [{ kind: "message", text: line, ts: Date.now() } as ArenaEvent] : parser.parse(line);
      handleEvents(events);
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => chunk.split("\n").forEach(handleLine));
    child.stderr.setEncoding("utf8");
    // stderr 分类（Task 0 修正的延续：不包 JSON 直接按行处理）——真错误上屏，调试噪音留档不展示
    child.stderr.on("data", (chunk: string) => chunk.split("\n").forEach((l) => {
      if (!l.trim()) return;
      handleEvents([{ kind: STDERR_ERR_RE.test(l) ? "error" : "system", text: l, ts: Date.now() }]);
    }));
    if (stdin) child.stdin.write(stdin, () => child.stdin.end());
    else child.stdin.end();
    child.on("error", (err) => {
      clearTimeout(timer);
      activeChildren.delete(runId);
      manualStops.delete(runId);
      updateRun(runId, { status: "failed", error: String(err), finishedAt: new Date(), durationMs: Date.now() - started });
      emit({ channel: "run-status", matchId, runId, status: "failed", error: String(err) });
      resolve();
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      activeChildren.delete(runId);
      handleEvents(parser.flush?.() ?? []);
      if (!doneEmitted) handleEvents([{ kind: "done", ts: Date.now() }]); // 保证轨迹以 done 收尾（UI/回放依赖）
      if (manualStops.has(runId)) stopReason = "用户手动停止";
      manualStops.delete(runId);
      finalStatus = timedOut ? "timeout" : code === 0 ? "completed" : "failed";
      if (stopReason) finalStatus = "failed"; // 手动/自动停止均按 failed 落库，error 记录原因
      updateRun(runId, { status: finalStatus, finishedAt: new Date(), durationMs: Date.now() - started, error: stopReason ?? undefined });
      emit({ channel: "run-status", matchId, runId, status: finalStatus, error: stopReason ?? undefined });
      resolve();
    });
  });

  // 修复验证：agent 正常结束后，若题目自带测试套件（package.json 的 test 脚本）则在运行目录跑一遍，
  // 结果作为独立指标落库（不改变 run status；超时上限 ARENA_VERIFY_TIMEOUT_MS），日志见 verify.log
  if (finalStatus === "completed" && !fake) {
    try {
      const v = await verifyFix(dir, { sourceDir, timeoutMs: VERIFY_TIMEOUT_MS });
      updateRun(runId, { verifyStatus: v.status });
    } catch {
      updateRun(runId, { verifyStatus: "skipped" });
    }
  }
}

export async function runMatch(matchId: string) {
  const match = getMatch(matchId);
  if (!match) throw new Error(`match ${matchId} not found`);
  updateMatch(matchId, { status: "running" });
  emit({ channel: "match-status", matchId, status: "running" });
  const combos: Combo[] = JSON.parse(match.combos);
  const limit = pLimit(CONCURRENCY);
  await Promise.all(combos.map((c, i) =>
    limit(() => executeRun(matchId, match.prompt, c, `r${i}_${Date.now().toString(36)}`, match.sourceDir)
      .catch(() => {/* executeRun 内部已落库失败态 */}))
  ));
  const finalRuns = listRuns(matchId);
  const allOk = finalRuns.every((r) => r.status === "completed");
  updateMatch(matchId, { status: allOk ? "completed" : "partial" });
  emit({ channel: "match-status", matchId, status: allOk ? "completed" : "partial" });
}

/** 同对局追加重跑：不建新对局，新旧 runs 同屏对比（runId 加 x 前缀避免与首轮 r{i}_ 冲突） */
export async function rerunCombos(matchId: string, combos: Combo[]) {
  const match = getMatch(matchId);
  if (!match) throw new Error(`match ${matchId} not found`);
  if (listRuns(matchId).some((r) => r.status === "running" || r.status === "pending")) {
    throw new Error("match is still running");
  }
  updateMatch(matchId, { status: "running" });
  emit({ channel: "match-status", matchId, status: "running" });
  const limit = pLimit(CONCURRENCY);
  const stamp = Date.now().toString(36);
  await Promise.all(combos.map((c, i) =>
    limit(() => executeRun(matchId, match.prompt, c, `x${stamp}${i}`, match.sourceDir)
      .catch(() => {/* executeRun 内部已落库失败态 */}))
  ));
  const finalRuns = listRuns(matchId);
  const allOk = finalRuns.every((r) => r.status === "completed");
  updateMatch(matchId, { status: allOk ? "completed" : "partial" });
  emit({ channel: "match-status", matchId, status: allOk ? "completed" : "partial" });
}
