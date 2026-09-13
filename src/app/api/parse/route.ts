import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { readJson, jsonError } from "@/lib/arena/http";
import { parseNaturalLanguage, type ParseResult } from "@/lib/arena/parser";

const ParseBodySchema = z.object({ input: z.string().min(1).max(20000) });

// 解析失败原因 → HTTP 状态与中文文案（no-credentials 是部署配置问题，与上游/输出错误区分开）
const REASON_TO_RESPONSE: Record<Exclude<ParseResult, { ok: true }>["reason"], { status: number; message: string }> = {
  "no-credentials": { status: 503, message: "未配置 ARK_BASE_URL / ARK_API_KEY，无法进行一句话解析，请手动配置" },
  "upstream-error": { status: 502, message: "解析服务出错，请稍后重试" },
  "invalid-output": { status: 502, message: "解析结果不符合预期，请换个说法或手动配置" },
};

export async function POST(req: NextRequest) {
  const body = await readJson(req, ParseBodySchema);
  if (!body.ok) return body.res;
  const result = await parseNaturalLanguage(body.data.input);
  if (!result.ok) {
    const { status, message } = REASON_TO_RESPONSE[result.reason];
    return jsonError(message, status);
  }
  return NextResponse.json({ config: result.config }); // 解析结果回显确认（ADR-0004），失败时前端回退手动表单
}
