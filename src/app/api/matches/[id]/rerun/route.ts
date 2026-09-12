import { NextRequest, NextResponse } from "next/server";
import { getMatch, createMatch } from "@/lib/db";
import { runMatch } from "@/lib/arena/runner";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const old = getMatch(id);
  if (!old) return NextResponse.json({ error: "not found" }, { status: 404 });
  const match = createMatch({ prompt: old.prompt, combos: JSON.parse(old.combos) });
  void runMatch(match.id);
  return NextResponse.json({ match }, { status: 201 });
}
