import { describe, it, expect, beforeEach, vi } from "vitest";
// 必须在 runner 模块求值前注入（vi.hoisted 先于 import 执行）：
// 把静默看门狗压到 300ms，让"幽灵定时器泄漏"在秒级暴露，而不用等默认 5 分钟
vi.hoisted(() => {
  process.env.ARENA_IDLE_TIMEOUT_MS = "300";
});
import path from "node:path";
import fs from "node:fs";
import os from "node:os";
import { runMatch } from "@/lib/arena/runner";
import { createMatch, listRuns } from "@/lib/db/index";
import { subscribe } from "@/lib/arena/bus";

describe("runner idle watchdog", () => {
  beforeEach(() => { process.env.ARENA_WORKDIR_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "arena-")); });

  it("run 结束后不再冒幽灵『静默超时』警告（看门狗泄漏回归）", async () => {
    const m = createMatch({ prompt: "p", combos: [{ harness: "opencode", model: "x" }] });
    // 正常完成的 fake：立刻输出一行并退出
    const script = path.join(os.tmpdir(), "arena-idle-ok.mjs");
    fs.writeFileSync(script, `console.log(JSON.stringify({kind:"message",text:"hi",ts:1}));`);
    process.env.ARENA_FAKE_CMD = `node ${script}`;
    const events: string[] = [];
    const unsub = subscribe((e) => { if (e.channel === "run-event") events.push(e.event.kind); });
    await runMatch(m.id);
    // 静置 700ms（> 300ms 看门狗周期）：若 close 时 flush 的 done 把定时器重新武装（泄漏），这里会冒出 warn
    await new Promise((r) => setTimeout(r, 700));
    unsub();
    const runs = listRuns(m.id);
    expect(runs[0].status).toBe("completed");
    expect(events.filter((k) => k === "warn")).toHaveLength(0);
  }, 30000);

  it("运行中持续静默会被看门狗停止并按 failed 落库", async () => {
    const m = createMatch({ prompt: "p", combos: [{ harness: "opencode", model: "x" }] });
    // 全程零输出的 fake：300ms 后应被看门狗击杀
    const script = path.join(os.tmpdir(), "arena-idle-hang.mjs");
    fs.writeFileSync(script, `setTimeout(() => {}, 10000);`);
    process.env.ARENA_FAKE_CMD = `node ${script}`;
    await runMatch(m.id);
    const runs = listRuns(m.id);
    expect(runs[0].status).toBe("failed");
    expect(runs[0].error).toContain("静默超时");
  }, 30000);
});
