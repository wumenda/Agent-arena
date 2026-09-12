import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getMatch, listRuns } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const match = getMatch(id);
  if (!match) return NextResponse.json({ error: "not found" }, { status: 404 });
  const runId = req.nextUrl.searchParams.get("runId");
  const run = listRuns(id).find((r) => r.id === runId);
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });
  try {
    const traj = readFileSync(path.join(run.workdir, "trajectory.jsonl"), "utf8");
    return NextResponse.json({ events: traj.split("\n").filter(Boolean).map((l) => JSON.parse(l)) });
  } catch {
    return NextResponse.json({ events: [] });
  }
}
