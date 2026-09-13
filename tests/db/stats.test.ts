import { describe, it, expect } from "vitest";
import { createRun, updateRun, getComboStats, getHarnessStats, getDailyTrend } from "@/lib/db/index";

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

describe("getHarnessStats / getDailyTrend", () => {
  it("aggregates per harness with summed cost", () => {
    createRun({ id: "hs1", matchId: "hsm", harness: "opencode", model: "m1", workdir: "/tmp/h1" });
    createRun({ id: "hs2", matchId: "hsm", harness: "opencode", model: "m2", workdir: "/tmp/h2" });
    updateRun("hs1", { status: "completed", durationMs: 1000, costUsd: 0.1, startedAt: new Date() });
    updateRun("hs2", { status: "failed", durationMs: 3000, costUsd: 0.05, startedAt: new Date() });

    const hs = getHarnessStats().find((s) => s.harness === "opencode")!;
    expect(hs.total).toBe(2);
    expect(hs.completed).toBe(1);
    expect(hs.avgDurationMs).toBe(2000);
    expect(hs.totalCostUsd).toBeCloseTo(0.15); // 累计花费而非均值
  });

  it("trend buckets runs by day and skips rows without startedAt", () => {
    createRun({ id: "tr1", matchId: "trm", harness: "codex", model: "m", workdir: "/tmp/t1" });
    createRun({ id: "tr2", matchId: "trm", harness: "codex", model: "m", workdir: "/tmp/t2" });
    updateRun("tr1", { status: "completed", startedAt: new Date() });
    updateRun("tr2", { status: "failed" }); // 未启动：不进趋势

    const trend = getDailyTrend(14);
    expect(trend).toHaveLength(14); // 固定 14 个桶
    const today = trend[trend.length - 1];
    expect(today.total).toBeGreaterThanOrEqual(1);
    expect(today.completed).toBeGreaterThanOrEqual(1);
    expect(today.completed).toBeLessThanOrEqual(today.total);
  });
});
