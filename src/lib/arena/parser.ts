import { MatchConfigSchema, type MatchConfig } from "./types";

const SYSTEM_PROMPT = `你是"模型-Agent竞技场"的实验配置解析器。用户用一句话描述想做的模型/harness 对比实验。
输出严格的 JSON（不要 markdown 代码块包裹）：
{"prompt": string, "combos": [{"harness": string, "model": string}]}
规则：
- harness 只能取 "claude-code" | "codex" | "opencode"
- model 使用各 harness 的模型标识：claude-code 如 "sonnet"/"opus"/"haiku"；codex 如 "gpt-5.2-codex"；opencode 如 "ark/glm-5.2"、"opencode/deepseek-v4-flash-free"
- 用户未指定模型时给该 harness 的默认模型；未指定 harness 时默认三个全选
- prompt 是去掉"对比/比较"等指令性措辞后的任务本体`;

export async function parseNaturalLanguage(input: string): Promise<MatchConfig | null> {
  const base = process.env.ARK_BASE_URL;
  const key = process.env.ARK_API_KEY;
  const model = process.env.ARK_MODEL ?? "glm-5.3-flash";
  if (!base || !key) return null;
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
    if (!res.ok) return null;
    const data = await res.json();
    const content: string = data.choices?.[0]?.message?.content ?? "";
    const jsonText = content.replace(/^```(?:json)?\s*/m, "").replace(/```\s*$/m, "").trim();
    const start = jsonText.indexOf("{");
    const end = jsonText.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    const parsed = MatchConfigSchema.safeParse(JSON.parse(jsonText.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
