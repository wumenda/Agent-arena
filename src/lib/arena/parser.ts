import { MatchConfigSchema, type MatchConfig } from "./types";
import { HARNESS_META } from "./adapters/meta";

// harness 枚举与模型示例从 HARNESS_META 单一事实来源生成（models 数组第一项即该 harness 的默认模型）
const harnessEnum = HARNESS_META.map((m) => `"${m.id}"`).join(" | ");
const modelHints = HARNESS_META
  .map((m) => `${m.id} 如 ${m.models.map((x) => JSON.stringify(x)).join("、")}`)
  .join("；");

const SYSTEM_PROMPT = `你是"Agent竞技场"的实验配置解析器。用户用一句话描述想做的模型/harness 对比实验。
输出严格的 JSON（不要 markdown 代码块包裹）：
{"prompt": string, "combos": [{"harness": string, "model": string}]}
规则：
- harness 只能取 ${harnessEnum}
- model 使用各 harness 的模型标识：${modelHints}
- 用户未指定模型时取该 harness 模型列表中的第一个；未指定 harness 时默认全部 harness 各选一个
- prompt 是去掉"对比/比较"等指令性措辞后的任务本体`;

/** 一句话解析结果：失败时携带可辨识原因，供路由映射 HTTP 状态与文案（null 无法区分失败原因） */
export type ParseResult =
  | { ok: true; config: MatchConfig }
  | { ok: false; reason: "no-credentials" | "upstream-error" | "invalid-output" };

export async function parseNaturalLanguage(input: string): Promise<ParseResult> {
  const base = process.env.ARK_BASE_URL;
  const key = process.env.ARK_API_KEY;
  const model = process.env.ARK_MODEL ?? "glm-5.3-flash";
  if (!base || !key) return { ok: false, reason: "no-credentials" };
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: input },
        ],
        temperature: 0,
      }),
    });
    if (!res.ok) return { ok: false, reason: "upstream-error" };
    const data = await res.json();
    const content: string = data.choices?.[0]?.message?.content ?? "";
    const jsonText = content.replace(/^```(?:json)?\s*/m, "").replace(/```\s*$/m, "").trim();
    const start = jsonText.indexOf("{");
    const end = jsonText.lastIndexOf("}");
    if (start === -1 || end === -1) return { ok: false, reason: "invalid-output" };
    const parsed = MatchConfigSchema.safeParse(JSON.parse(jsonText.slice(start, end + 1)));
    return parsed.success ? { ok: true, config: parsed.data } : { ok: false, reason: "invalid-output" };
  } catch {
    return { ok: false, reason: "upstream-error" };
  }
}
