import { NextRequest, NextResponse } from "next/server";
import { getMatch, listRuns } from "@/lib/db";
import { listRunFiles, readRunFile } from "@/lib/arena/files";

// ?runId=x            → 产出文件列表
// ?runId=x&path=y     → 单个文件内容（仅 workdir 内，防穿越）
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const match = getMatch(id);
  if (!match) return NextResponse.json({ error: "not found" }, { status: 404 });
  const runId = req.nextUrl.searchParams.get("runId");
  const run = listRuns(id).find((r) => r.id === runId);
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });
  const filePath = req.nextUrl.searchParams.get("path");
  try {
    if (!filePath) return NextResponse.json({ files: listRunFiles(run.workdir) });
    const file = readRunFile(run.workdir, filePath);
    if (!file) return NextResponse.json({ error: "invalid path" }, { status: 400 });
    return NextResponse.json(file);
  } catch {
    return NextResponse.json({ error: "read failed" }, { status: 500 });
  }
}
