import type { Combo } from "./types";
import { computeCostUsd, modelPrice } from "./pricing";

// 未收录模型的经验区间（pricing 单价表没有的模型；估算仅作开跑前的量级参考）
const FALLBACK_TIER = { low: 0.1, high: 0.8 };

/**
 * 经验成本区间由 pricing 单价表派生，避免双份分档各自漂移：
 * 轻负载按 5 万输入 + 1 万输出、重负载按 20 万输入 + 5 万输出折算成 USD。
 */
function tier(model: string) {
  const p = modelPrice(model);
  if (!p) return FALLBACK_TIER;
  return {
    low: p.inPrice * 0.05 + p.outPrice * 0.01,
    high: p.inPrice * 0.2 + p.outPrice * 0.05,
  };
}

export function estimateCost(combos: Combo[]): { low: number; high: number } {
  let low = 0, high = 0;
  for (const c of combos) {
    const t = tier(c.model);
    low += t.low;
    high += t.high;
  }
  return { low: Math.round(low * 100) / 100, high: Math.round(high * 100) / 100 };
}

// 跨对局聚合出的组合历史均值（/api/stats 的 stats 字段子集）
export type ComboHistoryStat = {
  harness: string;
  model: string;
  avgTokensIn: number | null;
  avgTokensOut: number | null;
};

/**
 * 优先用同组合的历史实测 token × 单价精算；没有历史的组合回退 tier 经验区间。
 * 精算的组合 low=high=实际值；返回 precise 表示参与精算的组合数，供 UI 标注估算口径。
 */
export function estimateCostFromHistory(
  combos: Combo[],
  history: ComboHistoryStat[]
): { low: number; high: number; precise: number } {
  const byKey = new Map(history.map((h) => [`${h.harness}×${h.model}`, h]));
  let low = 0, high = 0, precise = 0;
  for (const c of combos) {
    const h = byKey.get(`${c.harness}×${c.model}`);
    if (h?.avgTokensIn != null && h?.avgTokensOut != null) {
      const cost = computeCostUsd(c.model, { input: Math.round(h.avgTokensIn), output: Math.round(h.avgTokensOut) });
      if (cost != null) {
        low += cost;
        high += cost;
        precise++;
        continue;
      }
    }
    const t = tier(c.model);
    low += t.low;
    high += t.high;
  }
  return { low: Math.round(low * 100) / 100, high: Math.round(high * 100) / 100, precise };
}
