import { NextResponse } from "next/server";
import { getRunOfMatch } from "@/lib/db";
import { readTrajectory } from "@/lib/arena/files";
import { jsonError, withMatch } from "@/lib/arena/http";

// ?runId=x → 该运行的轨迹事件（缺失或损坏兜底空数组，前端可静态渲染已完成部分）
export const GET = withMatch(({ req, id }) => {
  const runId = req.nextUrl.searchParams.get("runId");
  const run = getRunOfMatch(id, runId ?? "");
  if (!run) return jsonError("运行不存在", 404);
  return NextResponse.json({ events: readTrajectory(run.workdir) });
});
