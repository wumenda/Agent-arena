import { spawn } from "node:child_process";
import { mkdirSync, appendFileSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import pLimit from "p-limit";
import { getMatch, createRun, updateRun, updateMatch, listRuns } from "@/lib/db";
import { adapters } from "./adapters/registry";
import { emit } from "./bus";
import type { ArenaEvent, Combo } from "./types";

const CONCURRENCY = Number(process.env.ARENA_CONCURRENCY ?? 3);
const TIMEOUT_MS = Number(process.env.ARENA_TIMEOUT_MS ?? 15 * 60 * 1000);

function workdirRoot() {
  // 默认放系统临时目录：workdir 若位于本项目 git 仓库内，opencode 会向上找到 git 根写文件，
  // 破坏运行隔离（实测）；ADR-0001 的「裸跑临时目录」即此意
  return process.env.ARENA_WORKDIR_ROOT ?? path.join(os.tmpdir(), "model-agent-arena", "runs");
}

function killTree(pid: number) {
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { shell: true });
  } else {
    try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch {} }
  }
}

async function executeRun(matchId: string, prompt: string, combo: Combo, runId: string) {
  const adapter = adapters[combo.harness];
  const dir = path.join(workdirRoot(), matchId, runId);
  mkdirSync(dir, { recursive: true });
  createRun({ id: runId, matchId, harness: combo.harness, model: combo.model, workdir: dir });
  updateRun(runId, { status: "running", startedAt: new Date() });
  emit({ channel: "run-status", matchId, runId, status: "running" });

  const trajPath = path.join(dir, "trajectory.jsonl");
  const writeTraj = (ev: ArenaEvent) => appendFileSync(trajPath, JSON.stringify(ev) + "\n");
  let doneEmitted = false;

  const handleEvents = (events: ArenaEvent[]) => {
    for (const ev of events) {
      if (ev.kind === "done") doneEmitted = true;
      writeTraj(ev);
      emit({ channel: "run-event", matchId, runId, event: ev });
      if (ev.kind === "done" && ev.usage) {
        updateRun(runId, { tokensIn: ev.usage.input, tokensOut: ev.usage.output, costUsd: ev.costUsd ?? null });
      }
    }
  };

  // 测试注入点：ARENA_FAKE_CMD[_<harness>] 优先于真实命令
  const fake = process.env[`ARENA_FAKE_CMD_${combo.harness}`] ?? process.env.ARENA_FAKE_CMD;
  let file: string, args: string[], stdin: string | undefined;
  if (fake) {
    const parts = fake.split(" ");
    file = parts[0]; args = parts.slice(1); stdin = undefined;
  } else {
    const cmd = adapter.buildCommand(combo, dir);
    file = cmd.file; args = cmd.args;
    stdin = cmd.stdin === "__PROMPT__" ? prompt : cmd.stdin;
    if (file === "claude") stdin = prompt; // claude -p 从 stdin 读 prompt
  }

  const parser = adapter.createParser();
  const started = Date.now();
  let timedOut = false;

  await new Promise<void>((resolve) => {
    const child = spawn(file, args, { cwd: dir, shell: true, env: { ...process.env } });
    const timer = setTimeout(() => { timedOut = true; killTree(child.pid!); }, TIMEOUT_MS);
    const handleLine = (line: string) => {
      if (!line.trim()) return;
      const events = fake ? [{ kind: "message", text: line, ts: Date.now() } as ArenaEvent] : parser.parse(line);
      handleEvents(events);
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => chunk.split("\n").forEach(handleLine));
    child.stderr.setEncoding("utf8");
    // stderr 直接作为 system 事件（Task 0 修正：不要包一层 JSON 再走 parser，否则会被吞掉）
    child.stderr.on("data", (chunk: string) => chunk.split("\n").forEach((l) => {
      if (!l.trim()) return;
      handleEvents([{ kind: "system", text: l, ts: Date.now() }]);
    }));
    if (stdin) child.stdin.write(stdin, () => child.stdin.end());
    else child.stdin.end();
    child.on("error", (err) => {
      clearTimeout(timer);
      updateRun(runId, { status: "failed", error: String(err), finishedAt: new Date(), durationMs: Date.now() - started });
      emit({ channel: "run-status", matchId, runId, status: "failed", error: String(err) });
      resolve();
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      handleEvents(parser.flush?.() ?? []);
      if (!doneEmitted) handleEvents([{ kind: "done", ts: Date.now() }]); // 保证轨迹以 done 收尾（UI/回放依赖）
      const status = timedOut ? "timeout" : code === 0 ? "completed" : "failed";
      updateRun(runId, { status, finishedAt: new Date(), durationMs: Date.now() - started });
      emit({ channel: "run-status", matchId, runId, status });
      resolve();
    });
  });
}

export async function runMatch(matchId: string) {
  const match = getMatch(matchId);
  if (!match) throw new Error(`match ${matchId} not found`);
  updateMatch(matchId, { status: "running" });
  emit({ channel: "match-status", matchId, status: "running" });
  const combos: Combo[] = JSON.parse(match.combos);
  const limit = pLimit(CONCURRENCY);
  await Promise.all(combos.map((c, i) =>
    limit(() => executeRun(matchId, match.prompt, c, `r${i}_${Date.now().toString(36)}`)
      .catch(() => {/* executeRun 内部已落库失败态 */}))
  ));
  const finalRuns = listRuns(matchId);
  const allOk = finalRuns.every((r) => r.status === "completed");
  updateMatch(matchId, { status: allOk ? "completed" : "partial" });
  emit({ channel: "match-status", matchId, status: allOk ? "completed" : "partial" });
}
