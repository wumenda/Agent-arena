import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getMatch, listRuns } from "@/lib/db";
import { buildMatchReport } from "@/lib/arena/report";
import type { ArenaEvent } from "@/lib/arena/types";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const match = getMatch(id);
  if (!match) return NextResponse.json({ error: "not found" }, { status: 404 });
  const runs = listRuns(id);
  const eventsByRun: Record<string, ArenaEvent[]> = {};
  for (const run of runs) {
    try {
      const traj = readFileSync(path.join(run.workdir, "trajectory.jsonl"), "utf8");
      eventsByRun[run.id] = traj.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    } catch {
      eventsByRun[run.id] = [];
    }
  }
  const md = buildMatchReport(match, runs, eventsByRun);
  return new NextResponse(md, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="match-${id}.md"`,
    },
  });
}
