import { describe, it, expect } from "vitest";
import { createRun, updateRun, getComboStats } from "@/lib/db/index";

describe("getComboStats", () => {
  it("aggregates per harness×model", () => {
    createRun({ id: "st1", matchId: "stm", harness: "claude-code", model: "glm-5.3-flash", workdir: "/tmp/a" });
    createRun({ id: "st2", matchId: "stm", harness: "claude-code", model: "glm-5.3-flash", workdir: "/tmp/b" });
    createRun({ id: "st3", matchId: "stm", harness: "codex", model: "glm-5.2", workdir: "/tmp/c" });
    updateRun("st1", { status: "completed", durationMs: 1000, tokensIn: 10, tokensOut: 5, costUsd: 0.1 });
    updateRun("st2", { status: "failed", durationMs: 3000 });
    updateRun("st3", { status: "completed", durationMs: 2000, costUsd: 0.2 });

    const stats = getComboStats();
    const cc = stats.find((s) => s.harness === "claude-code" && s.model === "glm-5.3-flash")!;
    expect(cc.total).toBe(2);
    expect(cc.completed).toBe(1);
    expect(cc.avgDurationMs).toBe(2000); // (1000+3000)/2
    const cx = stats.find((s) => s.harness === "codex")!;
    expect(cx.total).toBe(1);
    expect(cx.avgCostUsd).toBeCloseTo(0.2);
  });
});
