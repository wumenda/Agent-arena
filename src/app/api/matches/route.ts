import { NextRequest, NextResponse } from "next/server";
import { statSync } from "node:fs";
import { MatchConfigSchema } from "@/lib/arena/types";
import { createMatch, listMatches } from "@/lib/db";
import { runMatch } from "@/lib/arena/runner";

export async function GET() {
  return NextResponse.json({ matches: listMatches() });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = MatchConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  // 题目项目路径必须存在且为目录（本地校验，防止开跑后才失败）
  if (parsed.data.sourceDir) {
    try {
      if (!statSync(parsed.data.sourceDir).isDirectory()) throw new Error();
    } catch {
      return NextResponse.json({ error: { sourceDir: ["题目路径不存在或不是目录"] } }, { status: 400 });
    }
  }
  const match = createMatch(parsed.data);
  // 后台执行，不阻塞响应
  void runMatch(match.id);
  return NextResponse.json({ match }, { status: 201 });
}
