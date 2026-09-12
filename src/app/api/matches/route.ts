import { NextRequest, NextResponse } from "next/server";
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
  const match = createMatch(parsed.data);
  // 后台执行，不阻塞响应
  void runMatch(match.id);
  return NextResponse.json({ match }, { status: 201 });
}
