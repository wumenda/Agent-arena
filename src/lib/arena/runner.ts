import { spawn, type ChildProcess } from "node:child_process";
import { mkdirSync, appendFileSync } from "node:fs";
import path from "node:path";
import pLimit from "p-limit";
import { getMatch, getRun, createRun, updateRun, updateMatch, listRuns, getMatchCombos } from "@/lib/db";
import { toRunDTO } from "@/lib/db/schema";
import { adapters } from "./adapters/registry";
import { computeCostUsd } from "./pricing";
import { emit } from "./bus";
import { seedWorkdir } from "./seed";
import { verifyFix } from "./verify";
import { killTree } from "./proc";
import { workdirRoot } from "./paths";
import { extractPreviewUrl, savePreviewUrl, PREVIEW_PROMPT_HINT } from "./files";
import type { ArenaEvent, Combo } from "./types";

const CONCURRENCY = Number(process.env.ARENA_CONCURRENCY ?? 3);
// 全局并发闸门：跨对局共享同一闸门，同时开多局时总子进程数也不超过 CONCURRENCY
const globalLimit = pLimit(CONCURRENCY);
const TIMEOUT_MS = Number(process.env.ARENA_TIMEOUT_MS ?? 15 * 60 * 1000);
const VERIFY_TIMEOUT_MS = Number(process.env.ARENA_VERIFY_TIMEOUT_MS ?? 5 * 60 * 1000);
// 连续 N 次网络类错误（Reconnecting/Connection failed 等）自动停止该 agent
const NET_ERR_LIMIT = Number(process.env.ARENA_NET_ERR_LIMIT ?? 3);
const NET_ERR_RE = /reconnecting|connection failed|error sending request|econn(refused|reset|aborted)|etimedout|enotfound|fetch failed|socket hang up|network (error|issue)/i;
// 静默看门狗：连续 N ms 无任何事件（stdout/stderr 均无）判定请求挂起（如 LLM 连接被网关静默丢弃），
// 自动停止该 run 并按 failed 落库，避免用户对着空面板干等总超时
const IDLE_TIMEOUT_MS = Number(process.env.ARENA_IDLE_TIMEOUT_MS ?? 5 * 60 * 1000);
// stderr 行分类：显式 WARN 级别行 → warn（UI 黄色上屏，即使正文含 failed/error= 字样），
// 显式 ERROR/FATAL 级别行或命中错误特征的行升级为 error（UI 红色上屏），
// 其余是 CLI 调试/日志噪音（如 codex 时间戳 INFO 行、claude 调试行），仅留档与网络错误检测，UI 不展示
const STDERR_WARN_RE = /\bWARN(?:ING)?\b/;
const STDERR_ERR_LEVEL_RE = /\b(ERROR|FATAL|PANIC)\b/;
const STDERR_ERR_RE = /\b(error|failed|fatal|panic|exception|unauthorized|forbidden|invalid|refused|timed out|timeout|rate.?limit|quota|econn|disconnect)\b/i;

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

type TurnCmd = { file: string; args: string[]; stdin?: string; shell?: boolean };

// 单轮累加基线：续聊时在新一轮 done/收尾处把旧指标叠加，而不是覆盖
type MetricsBase = { tokensIn: number | null; tokensOut: number | null; costUsd: number | null; durationMs: number | null };

// 广播运行状态：事件直接携带完整运行 DTO（终态前指标/验证已落库，浏览器整行合并、无需再补拉）
function emitRunStatus(matchId: string, runId: string, status: string, error?: string) {
  const run = getRun(runId);
  if (run) emit({ channel: "run-status", matchId, runId, status, error, run: toRunDTO(run) });
}

/**
 * 单轮执行：跑一个 harness 子进程，事件写轨迹 + 总线广播，结束时落库状态与指标。
 * 首轮与续聊共用；accumulate=true 时指标在 base 上累加（续聊轮的 usage 只含本轮）。
 */
async function executeTurn(opts: {
  matchId: string;
  runId: string;
  combo: Combo;
  dir: string;
  cmd: TurnCmd;
  fake: boolean;
  sourceDir?: string | null;
  preamble?: ArenaEvent[]; // 进程启动前写入轨迹的事件（续聊的用户提问）
  accumulate?: boolean;
  base?: MetricsBase;
}) {
  const { matchId, runId, combo, dir, fake } = opts;
  const trajPath = path.join(dir, "trajectory.jsonl");
  const writeTraj = (ev: ArenaEvent) => appendFileSync(trajPath, JSON.stringify(ev) + "\n");
  let doneEmitted = false;
  // 协议层错误（adapter 的 error 事件：result.is_error / turn.failed 等）：退出码不可信时的失败依据
  let adapterError: string | null = null;
  // 网络错误连续计数与停止原因（手动/自动）；真实进展会重置计数
  let netErrStreak = 0;
  let stopReason: string | null = null;
  // 已写入的服务预览地址（去重：同一 URL 只落盘一次）
  let previewUrl: string | null = null;
  // 静默看门狗定时器：任何事件到达都重置；触发即杀进程并按 failed 收尾
  let idleTimer: NodeJS.Timeout | null = null;
  let childRef: ChildProcess | null = null;
  // 进程已收尾（close/error）标志：close 里 flush 出的 done 事件也会走 handleEvents，
  // 若不拦截会把看门狗重新武装成"幽灵定时器"——进程结束后到期乱发"静默超时"警告，
  // 且 warn 又触发重置形成 5 分钟一次的连锁（历史 bug：完成后卡片无端冒警告）
  let closed = false;
  const resetIdleWatchdog = () => {
    if (closed || stopReason) return; // 收尾后/已决定停止后不再重置
    if (idleTimer) clearTimeout(idleTimer);
    idleTimer = setTimeout(() => {
      if (stopReason) return;
      stopReason = `静默超时：${Math.round(IDLE_TIMEOUT_MS / 60000)} 分钟无任何事件输出（LLM 请求可能已挂起），已自动停止`;
      handleEvents([{ kind: "warn", text: stopReason, ts: Date.now() }]);
      if (childRef?.pid) killTree(childRef.pid);
    }, IDLE_TIMEOUT_MS);
  };

  const handleEvents = (events: ArenaEvent[]) => {
    if (events.length) resetIdleWatchdog();
    for (const ev of events) {
      if (ev.kind === "done") doneEmitted = true;
      if (ev.kind === "error" && !adapterError) adapterError = ev.text;
      writeTraj(ev);
      emit({ channel: "run-event", matchId, runId, event: ev });
      if (ev.kind === "done" && ev.usage) {
        // 成本统一按 tokens × 单价核算（CLI 自报成本对自定义供应商不可信，见 pricing.ts）；
        // 续聊轮在旧值上累加（本轮 usage 只统计本轮调用）
        const cost = computeCostUsd(combo.model, ev.usage) ?? null;
        ev.costUsd = cost ?? undefined;
        if (opts.accumulate) {
          const b = opts.base ?? { tokensIn: null, tokensOut: null, costUsd: null, durationMs: null };
          updateRun(runId, {
            tokensIn: (b.tokensIn ?? 0) + ev.usage.input,
            tokensOut: (b.tokensOut ?? 0) + ev.usage.output,
            costUsd: (b.costUsd ?? 0) + (cost ?? 0),
          });
        } else {
          updateRun(runId, { tokensIn: ev.usage.input, tokensOut: ev.usage.output, costUsd: cost });
        }
      }
      // 网络错误检测：system/warn/error 事件命中网络类关键词则计数，其余事件视为进展重置
      if (ev.kind === "system" || ev.kind === "warn" || ev.kind === "error") {
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
      // 服务预览嗅探：只从模型的文字输出（message 事件）中提取本机 URL；
      // 工具/命令输出、thinking 等中间结果不参与，避免把测试回显、配置内容误当服务地址
      const previewText = ev.kind === "message" ? ev.text : "";
      const found = extractPreviewUrl(previewText);
      if (found && found !== previewUrl) {
        previewUrl = found;
        savePreviewUrl(dir, found);
      }
    }
  };

  const parser = adapters[combo.harness].createParser();
  const started = Date.now();
  let finalStatus: "completed" | "failed" | "timeout" | null = null;

  // 进程启动前的前置事件（续聊的用户提问）：先入轨迹与 SSE，让对话流完整
  for (const ev of opts.preamble ?? []) {
    writeTraj(ev);
    emit({ channel: "run-event", matchId, runId, event: ev });
  }

  let timedOut = false;

  await new Promise<void>((resolve) => {
    const child = spawn(opts.cmd.file, opts.cmd.args, { cwd: dir, shell: opts.cmd.shell ?? true, env: { ...process.env } });
    childRef = child;
    resetIdleWatchdog(); // 进程启动即开始监测静默
    activeChildren.set(runId, child);
    const timer = setTimeout(() => { timedOut = true; killTree(child.pid!); }, TIMEOUT_MS);
    const handleLine = (line: string) => {
      if (!line.trim()) return;
      const events = fake ? fakeLineEvents(line) : parser.parse(line);
      handleEvents(events);
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => chunk.split("\n").forEach(handleLine));
    child.stderr.setEncoding("utf8");
    // stderr 分类（Task 0 修正的延续：不包 JSON 直接按行处理）——warn/error 上屏（黄/红），调试噪音留档不展示
    child.stderr.on("data", (chunk: string) => chunk.split("\n").forEach((l) => {
      if (!l.trim()) return;
      // 级别令牌优先：WARN 行归 warn（正文里的 failed/error= 字段名不算错误），
      // 带显式 ERROR/FATAL 级别的行归 error，无级别令牌时按错误特征兜底
      const kind: ArenaEvent["kind"] = STDERR_WARN_RE.test(l) && !STDERR_ERR_LEVEL_RE.test(l)
        ? "warn"
        : STDERR_ERR_RE.test(l) ? "error" : "system";
      handleEvents([{ kind, text: l, ts: Date.now() }]);
    }));
    if (opts.cmd.stdin) child.stdin.write(opts.cmd.stdin, () => child.stdin.end());
    else child.stdin.end();
    child.on("error", (err) => {
      closed = true;
      clearTimeout(timer);
      if (idleTimer) clearTimeout(idleTimer);
      activeChildren.delete(runId);
      manualStops.delete(runId);
      updateRun(runId, { status: "failed", error: String(err), finishedAt: new Date(), durationMs: Date.now() - started });
      emitRunStatus(matchId, runId, "failed", String(err));
      resolve();
    });
    child.on("close", (code) => {
      closed = true; // 先封看门狗：flush 出的 done 事件不得再重置定时器
      clearTimeout(timer);
      if (idleTimer) clearTimeout(idleTimer);
      activeChildren.delete(runId);
      handleEvents(parser.flush?.() ?? []);
      if (!doneEmitted) handleEvents([{ kind: "done", ts: Date.now() }]); // 保证轨迹以 done 收尾（UI/回放依赖）
      if (manualStops.has(runId)) stopReason = "用户手动停止";
      manualStops.delete(runId);
      finalStatus = timedOut ? "timeout" : code === 0 ? "completed" : "failed";
      if (stopReason) finalStatus = "failed"; // 手动/自动停止均按 failed 落库，error 记录原因
      // 退出码不可信：协议层已报错（result.is_error / turn.failed 等）时即使退出码 0 也按 failed 落库，
      // 避免"CLI 内部失败但退出码 0"污染统计与完成率
      if (!stopReason && finalStatus === "completed" && adapterError) {
        stopReason = adapterError;
        finalStatus = "failed";
      }
      const turnMs = Date.now() - started;
      const durationMs = opts.accumulate ? (opts.base?.durationMs ?? 0) + turnMs : turnMs;
      updateRun(runId, { status: finalStatus, finishedAt: new Date(), durationMs, error: stopReason ?? undefined });
      resolve();
    });
  });

  // 修复验证：agent 正常结束后，若题目自带测试套件（package.json 的 test 脚本）则在运行目录跑一遍，
  // 结果作为独立指标落库（不改变 run status；超时上限 ARENA_VERIFY_TIMEOUT_MS），日志见 verify.log。
  // 验证完成后再广播终态：前端收到 run-status 时指标/验证已落库，无需再补拉
  if (finalStatus === "completed" && !fake) {
    try {
      const v = await verifyFix(dir, { sourceDir: opts.sourceDir, timeoutMs: VERIFY_TIMEOUT_MS });
      updateRun(runId, { verifyStatus: v.status });
    } catch {
      updateRun(runId, { verifyStatus: "skipped" });
    }
  }

  emitRunStatus(matchId, runId, finalStatus ?? "failed", stopReason ?? undefined);
}

/** fake 命令解析：ARENA_FAKE_CMD_<harness> / ARENA_FAKE_CMD 指定测试替身（打印行即 message 事件） */
function resolveFake(harness: string): TurnCmd | null {
  const fake = process.env[`ARENA_FAKE_CMD_${harness}`] ?? process.env.ARENA_FAKE_CMD;
  if (!fake) return null;
  const parts = fake.split(" ");
  return { file: parts[0], args: parts.slice(1), stdin: undefined, shell: true };
}

// fake 输出事件化：普通行 → message；带 kind 字段的 JSON 行按 ArenaEvent 直通（测试可注入 done+usage 验证指标累加）
function fakeLineEvents(line: string): ArenaEvent[] {
  try {
    const j = JSON.parse(line);
    if (j && typeof j.kind === "string") return [j as ArenaEvent];
  } catch { /* 非 JSON 走 message 兜底 */ }
  return [{ kind: "message", text: line, ts: Date.now() }];
}

async function executeRun(matchId: string, prompt: string, combo: Combo, runId: string, sourceDir?: string | null) {
  const adapter = adapters[combo.harness];
  const dir = path.join(workdirRoot(), matchId, runId);
  mkdirSync(dir, { recursive: true });
  createRun({ id: runId, matchId, harness: combo.harness, model: combo.model, workdir: dir });
  updateRun(runId, { status: "running", startedAt: new Date() });
  emitRunStatus(matchId, runId, "running");

  // 题目项目预置：把源目录复制进本运行的独立工作目录（各 agent 拿同一道题的独立副本，隔离修改）
  if (sourceDir) {
    try {
      seedWorkdir(dir, sourceDir);
    } catch (err) {
      updateRun(runId, { status: "failed", error: `题目复制失败: ${String(err)}`, finishedAt: new Date(), durationMs: 0 });
      emitRunStatus(matchId, runId, "failed", String(err));
      return;
    }
  }

  const fake = resolveFake(combo.harness);
  const taskPrompt = prompt + PREVIEW_PROMPT_HINT; // 追加服务预览约定（fake 替身不读 prompt，无影响）
  let cmd: TurnCmd;
  if (fake) {
    cmd = fake;
  } else {
    const c = adapter.buildCommand(combo, dir, taskPrompt);
    cmd = { ...c, stdin: c.stdin === "__PROMPT__" ? taskPrompt : c.stdin };
  }
  await executeTurn({ matchId, runId, combo, dir, cmd, fake: !!fake, sourceDir });
}

/**
 * 会话续聊：向已结束的 Run 追加一条用户提问，在同 workdir 用 harness 的续聊参数
 * （--continue / resume --last）继续最近会话；事件追加进同一轨迹，指标累加。
 * 不改对局状态（其余 runs 不受影响），卡片状态经 run-status 事件回到 running。
 */
export async function continueRun(matchId: string, runId: string, prompt: string) {
  const run = getRun(runId);
  if (!run || run.matchId !== matchId) throw new Error("run not found");
  if (run.status === "running" || run.status === "pending") throw new Error("run is still running");
  const adapter = adapters[run.harness];
  if (!adapter.buildContinueCommand) throw new Error(`harness ${run.harness} 不支持会话续聊`);
  const match = getMatch(matchId);
  if (!match) throw new Error(`match ${matchId} not found`);

  const combo: Combo = { harness: run.harness as Combo["harness"], model: run.model };
  const dir = run.workdir;
  const base: MetricsBase = { tokensIn: run.tokensIn, tokensOut: run.tokensOut, costUsd: run.costUsd, durationMs: run.durationMs };
  updateRun(runId, { status: "running", error: null, startedAt: new Date(), finishedAt: null });
  emitRunStatus(matchId, runId, "running");

  const fake = resolveFake(combo.harness);
  const taskPrompt = prompt + PREVIEW_PROMPT_HINT; // 续聊轮同样追加服务预览约定
  let cmd: TurnCmd;
  if (fake) {
    cmd = fake;
  } else {
    const c = adapter.buildContinueCommand(combo, dir, taskPrompt);
    cmd = { ...c, stdin: c.stdin === "__PROMPT__" ? taskPrompt : c.stdin };
  }
  await executeTurn({
    matchId, runId, combo, dir, cmd, fake: !!fake, sourceDir: match.sourceDir,
    accumulate: true, base,
    preamble: [{ kind: "user", text: prompt, ts: Date.now() }],
  });
}

export async function runMatch(matchId: string) {
  const match = getMatch(matchId);
  if (!match) throw new Error(`match ${matchId} not found`);
  updateMatch(matchId, { status: "running" });
  emit({ channel: "match-status", matchId, status: "running" });
  const combos = getMatchCombos(matchId);
  await Promise.all(combos.map((c, i) =>
    globalLimit(() => executeRun(matchId, match.prompt, c, `r${i}_${Date.now().toString(36)}`, match.sourceDir)
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
  const stamp = Date.now().toString(36);
  await Promise.all(combos.map((c, i) =>
    globalLimit(() => executeRun(matchId, match.prompt, c, `x${stamp}${i}`, match.sourceDir)
      .catch(() => {/* executeRun 内部已落库失败态 */}))
  ));
  const finalRuns = listRuns(matchId);
  const allOk = finalRuns.every((r) => r.status === "completed");
  updateMatch(matchId, { status: allOk ? "completed" : "partial" });
  emit({ channel: "match-status", matchId, status: allOk ? "completed" : "partial" });
}
