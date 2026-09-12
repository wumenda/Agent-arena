import { describe, it, expect } from "vitest";
import { estimateCost } from "@/lib/arena/estimator";

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
