import type { Combo } from "./types";

const TIERS = [
  { re: /opus|gpt-5\.[12]|o4/i, low: 0.5, high: 2.0 },
  { re: /sonnet|gpt-5\.1|glm|deepseek|qwen/i, low: 0.1, high: 0.6 },
  { re: /haiku|mini|flash/i, low: 0.02, high: 0.1 },
  { re: /.*/, low: 0.1, high: 0.8 },
];

function tier(model: string) {
  return TIERS.find((t) => t.re.test(model))!;
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
