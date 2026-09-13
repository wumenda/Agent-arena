import type { TokenUsage } from "./types";

/**
 * 统一成本核算：
 * CLI 自报的成本不可信——claude 按 Anthropic 官方价目表计算自定义模型（虚高数倍）、
 * opencode 对自定义供应商报 0、codex 干脆不报。因此竞技场统一按 tokens × 单价 计算。
 *
 * 单价单位：USD / 1M tokens。按火山方舟等公开牌价维护，价格调整时改这里即可；
 * 未收录的模型返回 null（UI 显示 n/a），绝不编造成 0。
 */
const TABLE: { re: RegExp; inPrice: number; outPrice: number }[] = [
  // 火山方舟（Ark）
  { re: /glm-5\.3-flash/i, inPrice: 0.05, outPrice: 0.25 },
  { re: /glm-5\.[12]/i, inPrice: 0.2, outPrice: 0.8 },
  { re: /doubao-seed-2\.1-turbo|doubao-seed-2\.0/i, inPrice: 0.15, outPrice: 0.6 },
  { re: /doubao/i, inPrice: 0.4, outPrice: 1.6 },
  // 其他国产模型
  { re: /deepseek/i, inPrice: 0.3, outPrice: 1.1 },
  { re: /kimi/i, inPrice: 0.6, outPrice: 2.5 },
  { re: /qwen/i, inPrice: 0.2, outPrice: 0.8 },
  { re: /minimax/i, inPrice: 0.2, outPrice: 1.0 },
  { re: /^hy\d/i, inPrice: 0.3, outPrice: 1.2 }, // codebuddy hy 系列
  // Anthropic
  { re: /opus/i, inPrice: 15, outPrice: 75 },
  { re: /sonnet/i, inPrice: 3, outPrice: 15 },
  { re: /haiku/i, inPrice: 1, outPrice: 5 },
  // OpenAI
  { re: /o\d/i, inPrice: 2, outPrice: 8 },
  { re: /gpt/i, inPrice: 1.5, outPrice: 6 },
];

export function modelPrice(model: string): { inPrice: number; outPrice: number } | null {
  return TABLE.find((t) => t.re.test(model)) ?? null;
}

/** tokens × 单价 → USD；模型未收录返回 null。缓存读取按输入档计价。 */
export function computeCostUsd(model: string, usage: TokenUsage): number | null {
  const p = modelPrice(model);
  if (!p) return null;
  const input = usage.input + (usage.cacheRead ?? 0);
  const cost = (input * p.inPrice + usage.output * p.outPrice) / 1e6;
  return Math.round(cost * 1e6) / 1e6;
}
