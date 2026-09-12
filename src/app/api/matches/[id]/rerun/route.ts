import { NextRequest, NextResponse } from "next/server";
import { getMatch, createMatch } from "@/lib/db";
import { runMatch } from "@/lib/arena/runner";
import { MatchConfigSchema } from "@/lib/arena/types";

// 重跑：body 可选 {combos:[{harness,model}]}——指定则部分重跑，缺省全量；血缘指向原对局
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const old = getMatch(id);
  if (!old) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  let combos = JSON.parse(old.combos) as { harness: string; model: string }[];
  if (Array.isArray(body?.combos) && body.combos.length > 0) {
    const parsed = MatchConfigSchema.pick({ combos: true }).safeParse({ combos: body.combos });
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    combos = parsed.data.combos;
  }
  const match = createMatch({ prompt: old.prompt, combos, parentMatchId: old.id });
  void runMatch(match.id);
  return NextResponse.json({ match }, { status: 201 });
}
