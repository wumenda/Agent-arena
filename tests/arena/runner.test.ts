process.env.ARENA_DB = ":memory:";
import { describe, it, expect, beforeEach } from "vitest";
import path from "node:path";
import { runMatch } from "@/lib/arena/runner";
import { listRuns, createMatch } from "@/lib/db/index";
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
});
