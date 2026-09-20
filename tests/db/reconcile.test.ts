process.env.ARENA_DB = ":memory:";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, mkdirSync, existsSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { createMatch, createRun, updateRun, reconcileStaleRuns, cleanupStaleWorkdirs, getRun, listRuns, getMatch } from "@/lib/db/index";

// workdir 根：测试里用临时目录，cleanupStaleWorkdirs 按 DB 里的 workdir 绝对路径删目录
let tmpRoot: string;
beforeEach(() => {
  tmpRoot = mkdtempSync(path.join(os.tmpdir(), "arena-reconcile-"));
});
afterEach(() => {
  rmSync(tmpRoot, { recursive: true, force: true });
});

describe("reconcileStaleRuns（服务重启后的尸体收敛）", () => {
  it("running/pending 收敛为 failed，对局收敛为 partial；completed 不受影响", () => {
    const m = createMatch({ prompt: "p", combos: [{ harness: "claude-code", model: "x" }, { harness: "codex", model: "y" }] });
    createRun({ id: "r_dead", matchId: m.id, harness: "claude-code", model: "x", workdir: "w1" });
    createRun({ id: "r_pend", matchId: m.id, harness: "codex", model: "y", workdir: "w2" });
    // 模拟重启前的状态：一个 running 尸体、一个还没启动的 pending
    updateRun("r_dead", { status: "running" });

    expect(reconcileStaleRuns()).toBe(2);
    expect(getRun("r_dead")!.status).toBe("failed");
    expect(getRun("r_dead")!.error).toContain("服务重启");
    expect(getRun("r_pend")!.status).toBe("failed");
    // 有失败 run 的对局收敛为 partial
    expect(getMatch(m.id)!.status).toBe("partial");
  });

  it("无尸体时幂等零收敛（返回 0，不改变任何状态）", () => {
    const m = createMatch({ prompt: "p", combos: [{ harness: "codex", model: "y" }] });
    createRun({ id: "r_ok", matchId: m.id, harness: "codex", model: "y", workdir: "w" });
    updateRun("r_ok", { status: "completed" });

    expect(reconcileStaleRuns()).toBe(0);
    expect(getRun("r_ok")!.status).toBe("completed");
    expect(getMatch(m.id)!.status).toBe("pending"); // 未被误改
  });

  it("跨对局收敛：每个对局独立按自己的 runs 判定终态", () => {
    const m1 = createMatch({ prompt: "p1", combos: [{ harness: "codex", model: "y" }] });
    const m2 = createMatch({ prompt: "p2", combos: [{ harness: "codex", model: "y" }] });
    createRun({ id: "r1", matchId: m1.id, harness: "codex", model: "y", workdir: "w1" });
    createRun({ id: "r2", matchId: m2.id, harness: "codex", model: "y", workdir: "w2" });
    updateRun("r1", { status: "running" });
    updateRun("r2", { status: "completed" });

    expect(reconcileStaleRuns()).toBe(1);
    expect(listRuns(m1.id)[0].status).toBe("failed");
    expect(getMatch(m1.id)!.status).toBe("partial");
    expect(getMatch(m2.id)!.status).toBe("pending"); // m2 无尸体，不动
  });
});

describe("cleanupStaleWorkdirs（超期 workdir 清理）", () => {
  it("keepDays<=0 时不做任何清理", () => {
    expect(cleanupStaleWorkdirs(0)).toBe(0);
  });

  it("超期已结束 run 的 workdir 被删除；未超期/运行中的保留", () => {
    // 三种情况分属不同对局（cleanupStaleWorkdirs 按对局整体判断：对局内还有活动 run 就不删）
    const mOld = createMatch({ prompt: "old", combos: [{ harness: "codex", model: "y" }] });
    const mFresh = createMatch({ prompt: "fresh", combos: [{ harness: "codex", model: "y" }] });
    const mRun = createMatch({ prompt: "run", combos: [{ harness: "codex", model: "y" }] });
    // 生产布局 <root>/<matchId>/<runId>：dirname(workdir) = 对局目录
    const oldDir = path.join(tmpRoot, mOld.id);
    const freshDir = path.join(tmpRoot, mFresh.id);
    const runningDir = path.join(tmpRoot, mRun.id);
    for (const d of [oldDir, freshDir, runningDir]) mkdirSync(path.join(d, "r1"), { recursive: true });
    createRun({ id: "rold", matchId: mOld.id, harness: "codex", model: "y", workdir: path.join(oldDir, "r1") });
    createRun({ id: "rfresh", matchId: mFresh.id, harness: "codex", model: "y", workdir: path.join(freshDir, "r1") });
    createRun({ id: "rrun", matchId: mRun.id, harness: "codex", model: "y", workdir: path.join(runningDir, "r1") });
    // 10 天前结束的、1 天前结束的、运行中的
    updateRun("rold", { status: "completed", finishedAt: new Date(Date.now() - 10 * 86400000) });
    updateRun("rfresh", { status: "completed", finishedAt: new Date(Date.now() - 1 * 86400000) });
    updateRun("rrun", { status: "running" });

    expect(cleanupStaleWorkdirs(7)).toBe(1); // 只删 10 天前的
    expect(existsSync(oldDir)).toBe(false);
    expect(existsSync(freshDir)).toBe(true);
    expect(existsSync(runningDir)).toBe(true);
  });

  it("对局内还有 pending run 时整目录不删（避免误删仍在使用的目录）", () => {
    const m = createMatch({ prompt: "p", combos: [{ harness: "codex", model: "y" }] });
    const dir = path.join(tmpRoot, m.id);
    mkdirSync(path.join(dir, "r1"), { recursive: true });
    createRun({ id: "mix1", matchId: m.id, harness: "codex", model: "y", workdir: path.join(dir, "r1") });
    createRun({ id: "mix2", matchId: m.id, harness: "codex", model: "y", workdir: path.join(dir, "r2") });
    updateRun("mix1", { status: "completed", finishedAt: new Date(Date.now() - 10 * 86400000) });
    updateRun("mix2", { status: "pending" });

    cleanupStaleWorkdirs(7);
    expect(existsSync(dir)).toBe(true); // 有 pending，保守不删整目录
  });
});
