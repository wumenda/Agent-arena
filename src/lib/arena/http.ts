import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";
import { z } from "zod";
import { getMatch } from "@/lib/db";
import type { MatchRow } from "@/lib/db/schema";

// 统一错误响应：所有 API 路由错误一律 { error: string }，前端按字符串展示
export function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

// [id] 路由统一入口：解包 params、校验对局存在（不存在统一 404「对局不存在」），
// 消除各路由重复的 getMatch + 404 样板
export function withMatch(
  handler: (ctx: { req: NextRequest; id: string; match: MatchRow }) => Promise<NextResponse> | NextResponse
) {
  return async (req: NextRequest, { params }: { params: Promise<{ id: string }> }) => {
    const { id } = await params;
    const match = getMatch(id);
    if (!match) return jsonError("对局不存在", 404);
    return handler({ req, id, match });
  };
}

// 统一读取并校验 JSON body：非法 JSON / schema 校验失败一律 400，
// 消除各路由裸 req.json() 导致的 500 与多种错误格式混用
export async function readJson<T>(
  req: Request,
  schema: z.ZodType<T>,
): Promise<{ ok: true; data: T } | { ok: false; res: NextResponse }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return { ok: false, res: jsonError("请求体不是合法 JSON", 400) };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`).join("；");
    return { ok: false, res: jsonError(`参数校验失败：${msg}`, 400) };
  }
  return { ok: true, data: parsed.data };
}
