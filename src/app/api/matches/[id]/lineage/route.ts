import { NextRequest, NextResponse } from "next/server";
import { getLineage, listRuns } from "@/lib/db";

// 血缘链：沿重跑血缘回溯，每代展开完整 runs 指标（供趋势图使用）
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const chain = getLineage(id);
  if (chain.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    lineage: chain.map((m) => ({
      id: m.id,
      createdAt: m.createdAt,
      status: m.status,
      runs: listRuns(m.id).map((r) => ({
        harness: r.harness,
        model: r.model,
        status: r.status,
        durationMs: r.durationMs,
        costUsd: r.costUsd,
      })),
    })),
  });
}
