import { NextRequest, NextResponse } from "next/server";
import { MatchConfigSchema } from "@/lib/arena/types";
import { createMatch, listMatches, countMatches } from "@/lib/db";
import { runMatch } from "@/lib/arena/runner";
import { resolveQuestionDir } from "@/lib/arena/questions";
import { jsonError, readJson } from "@/lib/arena/http";

export async function GET(req: NextRequest) {
  // 分页：默认 200 条（个人工具历史列表足够）；offset 供历史页"加载更多"
  const sp = req.nextUrl.searchParams;
  const limit = Math.min(Number(sp.get("limit")) || 200, 200);
  const offset = Math.max(Number(sp.get("offset")) || 0, 0);
  const total = countMatches();
  const matches = listMatches(limit, offset);
  return NextResponse.json({ matches, total, hasMore: offset + matches.length < total });
}

export async function POST(req: NextRequest) {
  const body = await readJson(req, MatchConfigSchema);
  if (!body.ok) return body.res;
  // 题库选题解析为题目目录（服务端定路径，客户端只传 bank+id，防路径注入；本地校验防开跑后才失败）
  let sourceDir: string | undefined;
  if (body.data.question) {
    const dir = resolveQuestionDir(body.data.question.bank, body.data.question.id);
    if (!dir) {
      return jsonError("题库中找不到该题目，请重新选择", 400);
    }
    sourceDir = dir;
  }
  const match = createMatch({ prompt: body.data.prompt, combos: body.data.combos, sourceDir });
  // 后台执行，不阻塞响应
  void runMatch(match.id);
  return NextResponse.json({ match }, { status: 201 });
}
