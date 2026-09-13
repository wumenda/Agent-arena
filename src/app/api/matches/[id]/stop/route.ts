import { NextRequest, NextResponse } from "next/server";
import { listRuns } from "@/lib/db";
import { stopRun } from "@/lib/arena/runner";

// 手动停止对局中的单个 agent（杀进程树；close 后按 failed 落库，error=用户手动停止）
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { runId } = await req.json();
  const run = listRuns(id).find((r) => r.id === runId);
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });
  if (run.status !== "running") return NextResponse.json({ ok: false, error: "该 agent 不在运行中" }, { status: 409 });
  const ok = stopRun(runId);
  if (!ok) return NextResponse.json({ ok: false, error: "停止失败（进程已退出）" }, { status: 409 });
  return NextResponse.json({ ok: true });
}
