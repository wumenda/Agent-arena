import { describe, expect, it } from "vitest";
import { computeCostUsd, modelPrice } from "@/lib/arena/pricing";

describe("pricing 统一成本核算", () => {
  it("已知模型返回单价（flash 命中低价档，不与 glm-5.x 混淆）", () => {
    const pick = (m: string) => { const p = modelPrice(m)!; return { inPrice: p.inPrice, outPrice: p.outPrice }; };
    expect(pick("glm-5.3-flash")).toEqual({ inPrice: 0.05, outPrice: 0.25 });
    expect(pick("glm-5.2")).toEqual({ inPrice: 0.2, outPrice: 0.8 });
    expect(pick("ark/glm-5.2")).toEqual({ inPrice: 0.2, outPrice: 0.8 });
    expect(pick("sonnet")).toEqual({ inPrice: 3, outPrice: 15 });
  });

  it("未知模型返回 null（显示 n/a，不编造成 0）", () => {
    expect(modelPrice("totally-unknown-model")).toBeNull();
    expect(computeCostUsd("totally-unknown-model", { input: 1000, output: 100 })).toBeNull();
  });

  it("成本 = input×输入价 + cacheRead×输入价×10% + output×输出价，按 1M 归一（结果四舍五入到 1e-6）", () => {
    // glm-5.3-flash: 38163 in + 64 out → (38163×0.05 + 64×0.25)/1e6 ≈ $0.0019
    const cost = computeCostUsd("glm-5.3-flash", { input: 38163, output: 64, cacheRead: 0 });
    expect(cost).toBeCloseTo((38163 * 0.05 + 64 * 0.25) / 1e6, 6);
    // 缓存读取按输入价 10% 计（公允缓存价，而非全额输入价——修复重度缓存组合成本虚高 10 倍）
    const withCache = computeCostUsd("glm-5.3-flash", { input: 1000, output: 0, cacheRead: 1000 });
    expect(withCache).toBeCloseTo((1000 * 0.05 + 1000 * 0.05 * 0.1) / 1e6, 6);
  });

  it("真实规模量级合理：hello.txt 任务成本应在分厘级而非 $0.19", () => {
    const cost = computeCostUsd("glm-5.3-flash", { input: 38163, output: 64 });
    expect(cost!).toBeLessThan(0.01);
  });
});
