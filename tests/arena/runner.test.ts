process.env.ARENA_DB = ":memory:";
import { describe, it, expect, beforeEach } from "vitest";
import path from "node:path";
import { runMatch, continueRun } from "@/lib/arena/runner";
import { listRuns, getRun, createMatch, getMatch } from "@/lib/db/index";
import { subscribe } from "@/lib/arena/bus";
import fs from "node:fs";
import os from "node:os";

// fake harness：一个打印 JSONL 的 node 脚本
const fakeScript = path.join(os.tmpdir(), "arena-fake-harness.mjs");
fs.writeFileSync(fakeScript, `console.log(JSON.stringify({type:"text",text:"hi"}));`);

describe("runner", () => {
  beforeEach(() => { process.env.ARENA_WORKDIR_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "arena-")); });

  it("executes a match: runs complete, events captured, metrics persisted", async () => {
    const m = createMatch({ prompt: "say hi", combos: [{ harness: "claude-code", model: "x" }] });
    // 注入 fake：测试模式下 runner 使用 process.env.ARENA_FAKE_CMD 指定的命令
    process.env.ARENA_FAKE_CMD = `node ${fakeScript}`;
    const received: string[] = [];
    const unsub = subscribe((e) => { if (e.channel === "run-event") received.push(e.event.kind); });
    await runMatch(m.id);
    unsub();
    const runs = listRuns(m.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("completed");
    expect(received).toContain("message");
    expect(received).toContain("done");
    // 轨迹文件落盘
    const traj = fs.readFileSync(path.join(runs[0].workdir, "trajectory.jsonl"), "utf8");
    expect(traj).toContain("message");
  }, 30000);

  it("marks a failing combo as failed without blocking others", async () => {
    const m = createMatch({ prompt: "p", combos: [
      { harness: "claude-code", model: "x" },
      { harness: "codex", model: "y" },
    ]});
    // fake: claude-code 成功脚本、codex 失败脚本（退出码 1）
    const ok = path.join(os.tmpdir(), "arena-ok.mjs");
    const bad = path.join(os.tmpdir(), "arena-bad.mjs");
    fs.writeFileSync(ok, `console.log(JSON.stringify({type:"text",text:"ok"}))`);
    fs.writeFileSync(bad, `process.exit(1)`);
    process.env.ARENA_FAKE_CMD = `node ${ok}`;
    process.env.ARENA_FAKE_CMD_codex = `node ${bad}`;
    await runMatch(m.id);
    const runs = listRuns(m.id);
    const byHarness = Object.fromEntries(runs.map((r) => [r.harness, r.status]));
    expect(byHarness["claude-code"]).toBe("completed");
    expect(byHarness["codex"]).toBe("failed");
    const { getMatch } = await import("@/lib/db/index");
    expect(getMatch(m.id)!.status).toBe("partial");
  }, 30000);

  it("classifies stderr: INFO 噪音留档不展示、WARN 黄色上屏、真错误红色上屏", async () => {
    const m = createMatch({ prompt: "p", combos: [{ harness: "claude-code", model: "x" }] });
    const noisy = path.join(os.tmpdir(), "arena-noisy.mjs");
    fs.writeFileSync(noisy, [
      `console.error("2026-09-13T02:00:11.881413Z INFO codex_exec: noise line");`,
      // WARN 行（正文含 failed/error= 字样也算警告，不算错误）
      `console.error("2026-09-13T02:00:12.000000Z  WARN shell_snapshot: Failed to create shell snapshot for powershell");`,
      `console.error("2026-09-13T02:00:13.000000Z  WARN plugins: failed to warm cache error=failed to send request");`,
      // INFO 行内嵌显式 ERROR 级别令牌 → 按错误处理
      `console.error("2026-09-13T02:00:14.000000Z INFO launcher: MCP server stderr: ERROR node_repl: auth fetch failed");`,
      `console.error("API Error: 401 unauthorized");`,
      `console.log(JSON.stringify({type:"text",text:"hi"}));`,
    ].join("\n"));
    process.env.ARENA_FAKE_CMD = `node ${noisy}`;
    const events: { kind: string; text?: string }[] = [];
    const unsub = subscribe((e) => {
      if (e.channel === "run-event") events.push({ kind: e.event.kind, text: (e.event as { text?: string }).text });
    });
    await runMatch(m.id);
    unsub();
    // 时间戳 INFO 行 → system（不展示）；WARN 级别 → warn（黄）；真错误 → error（红）
    expect(events.some((e) => e.kind === "system" && e.text?.includes("INFO"))).toBe(true);
    expect(events.some((e) => e.kind === "warn" && e.text?.includes("shell_snapshot"))).toBe(true);
    expect(events.some((e) => e.kind === "warn" && e.text?.includes("error=failed"))).toBe(true);
    expect(events.some((e) => e.kind === "error" && e.text?.includes("ERROR node_repl"))).toBe(true);
    expect(events.some((e) => e.kind === "error" && e.text?.includes("unauthorized"))).toBe(true);
  }, 30000);

  it("continueRun: 同轨迹追加续聊轮，指标累加，对局状态不变", async () => {
    const m = createMatch({ prompt: "p", combos: [{ harness: "opencode", model: "x" }] });
    // 第一轮：message + done（带 usage，验证指标落库）
    const turn1 = path.join(os.tmpdir(), "arena-turn1.mjs");
    fs.writeFileSync(turn1, [
      `console.log(JSON.stringify({kind:"message",text:"t1",ts:1}));`,
      `console.log(JSON.stringify({kind:"done",usage:{input:100,output:50},ts:2}));`,
    ].join("\n"));
    process.env.ARENA_FAKE_CMD = `node ${turn1}`;
    await runMatch(m.id);
    const [r] = listRuns(m.id);
    expect(r.status).toBe("completed");
    expect(r.tokensIn).toBe(100);
    expect(r.tokensOut).toBe(50);
    const d1 = r.durationMs ?? 0;

    // 第二轮（续聊）：usage 只含本轮，runner 应在旧值上累加
    const turn2 = path.join(os.tmpdir(), "arena-turn2.mjs");
    fs.writeFileSync(turn2, [
      `console.log(JSON.stringify({kind:"message",text:"t2",ts:3}));`,
      `console.log(JSON.stringify({kind:"done",usage:{input:10,output:5},ts:4}));`,
    ].join("\n"));
    process.env.ARENA_FAKE_CMD = `node ${turn2}`;
    await continueRun(m.id, r.id, "再改一下配色");

    const r2 = getRun(r.id)!;
    expect(r2.status).toBe("completed");
    expect(r2.tokensIn).toBe(110);
    expect(r2.tokensOut).toBe(55);
    expect((r2.durationMs ?? 0)).toBeGreaterThanOrEqual(d1); // 耗时累加而非覆盖
    // 同一轨迹：首轮 t1 + 用户追问 + 续聊轮 t2 全部在 trajectory.jsonl
    const traj = fs.readFileSync(path.join(r2.workdir, "trajectory.jsonl"), "utf8");
    expect(traj).toContain("t1");
    expect(traj).toContain("再改一下配色");
    expect(traj).toContain("t2");
    // 续聊不改对局状态
    expect(getMatch(m.id)!.status).toBe("completed");
  }, 30000);

  it("continueRun: 运行中的 run 拒绝续聊、不支持的 harness 报错", async () => {
    const m = createMatch({ prompt: "p", combos: [{ harness: "pi", model: "x" }] });
    process.env.ARENA_FAKE_CMD = `node ${fakeScript}`;
    await runMatch(m.id);
    const [r] = listRuns(m.id);
    // pi 未实现 buildContinueCommand
    await expect(continueRun(m.id, r.id, "hi")).rejects.toThrow("不支持会话续聊");
    await expect(continueRun(m.id, "no-such-run", "hi")).rejects.toThrow("not found");
  }, 30000);

  it("preview 嗅探：只匹配模型 message 输出，工具/命令等中间结果不参与", async () => {
    const m = createMatch({ prompt: "p", combos: [{ harness: "claude-code", model: "x" }] });
    const script = path.join(os.tmpdir(), "arena-preview.mjs");
    fs.writeFileSync(script, [
      `console.log(JSON.stringify({kind:"command",command:"npm run dev",output:"Local: http://localhost:9999",ts:1}));`,
      `console.log(JSON.stringify({kind:"tool_result",tool:"bash",output:"http://localhost:8888",ts:2}));`,
      `console.log(JSON.stringify({kind:"message",text:"服务已启动 http://localhost:7777",ts:3}));`,
      `console.log(JSON.stringify({kind:"done",ts:4}));`,
    ].join("\n"));
    process.env.ARENA_FAKE_CMD = `node ${script}`;
    await runMatch(m.id);
    const [r] = listRuns(m.id);
    // 只有 message 里的 7777 被写入；命令输出里的 9999 / 工具结果里的 8888 被忽略
    const saved = fs.readFileSync(path.join(r.workdir, ".arena", "preview-url"), "utf8");
    expect(saved).toBe("http://localhost:7777");
  }, 30000);
});
