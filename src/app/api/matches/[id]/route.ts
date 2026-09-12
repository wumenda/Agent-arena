import { NextRequest, NextResponse } from "next/server";
import { getMatch, listRuns } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const match = getMatch(id);
  if (!match) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ match, runs: listRuns(id) });
}
