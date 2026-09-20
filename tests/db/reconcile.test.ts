process.env.ARENA_DB = ":memory:";
import { describe, it, expect } from "vitest";
import { createMatch, createRun, updateRun, reconcileStaleRuns, getRun, listRuns, getMatch } from "@/lib/db/index";

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
