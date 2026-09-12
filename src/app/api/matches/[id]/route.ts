import { NextRequest, NextResponse } from "next/server";
import { getMatch, listRuns, deleteMatch } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const match = getMatch(id);
  if (!match) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ match, runs: listRuns(id) });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = deleteMatch(id);
  if (!result.ok) {
    const status = result.error === "not found" ? 404 : 409;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true });
}
