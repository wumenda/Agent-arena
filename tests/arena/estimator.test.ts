import { describe, it, expect } from "vitest";
import { estimateCost, estimateCostFromHistory } from "@/lib/arena/estimator";
import type { Combo } from "@/lib/arena/types";

describe("estimateCost", () => {
  it("scales with combo count by model tier", () => {
    const cheap = estimateCost([{ harness: "opencode", model: "zhipu/glm-4.6" }]);
    const pricey = estimateCost([{ harness: "claude-code", model: "opus" }]);
    expect(cheap.high).toBeLessThan(pricey.high);
    const two = estimateCost([
      { harness: "claude-code", model: "opus" },
      { harness: "claude-code", model: "opus" },
    ]);
    expect(two.low).toBeCloseTo(pricey.low * 2);
  });
});

describe("estimateCostFromHistory", () => {
  it("prices combos with history tokens precisely and falls back to tier", () => {
    const combos: Combo[] = [
      { harness: "opencode", model: "agentplan/glm-5.3-flash" },
      { harness: "claude-code", model: "sonnet" },
    ];
    const history = [
      // glm-5.3-flash: (100000×0.05 + 20000×0.25)/1e6 = 0.01
      { harness: "opencode", model: "agentplan/glm-5.3-flash", avgTokensIn: 100000, avgTokensOut: 20000 },
    ];
    const est = estimateCostFromHistory(combos, history);
    expect(est.precise).toBe(1);
    expect(est.low).toBeCloseTo(0.01 + 0.3); // 精算 + sonnet tier low（3×0.05 + 15×0.01）
    expect(est.high).toBeCloseTo(0.01 + 1.35); // 精算 + sonnet tier high（3×0.2 + 15×0.05）
  });

  it("is exact (low==high) when all combos have priced history", () => {
    const combos: Combo[] = [{ harness: "opencode", model: "agentplan/glm-5.3-flash" }];
    const est = estimateCostFromHistory(combos, [
      { harness: "opencode", model: "agentplan/glm-5.3-flash", avgTokensIn: 100000, avgTokensOut: 20000 },
    ]);
    expect(est.precise).toBe(1);
    expect(est.low).toBe(est.high);
  });

  it("falls back entirely when history lacks tokens or model is unpriced", () => {
    const combos: Combo[] = [{ harness: "opencode", model: "agentplan/glm-5.3-flash" }];
    const tier = estimateCost(combos);
    const noTokens = estimateCostFromHistory(combos, [
      { harness: "opencode", model: "agentplan/glm-5.3-flash", avgTokensIn: null, avgTokensOut: null },
    ]);
    expect(noTokens.low).toBe(tier.low);
    expect(noTokens.precise).toBe(0);
  });
});
