import { NextResponse } from "next/server";
import { getRunOfMatch } from "@/lib/db";
import { continueRun } from "@/lib/arena/runner";
import { jsonError, readJson, withMatch } from "@/lib/arena/http";
import { ContinueRunSchema } from "@/lib/arena/types";

// 会话续聊：body {runId, prompt}——在指定 run 的原 workdir 继续最近会话，
// 事件追加进同一轨迹并经 SSE 实时上屏；只校验该 run 自身状态，不影响其余 runs。
export const POST = withMatch(async ({ req, id }) => {
  const body = await readJson(req, ContinueRunSchema);
  if (!body.ok) return body.res;
  const run = getRunOfMatch(id, body.data.runId);
  if (!run) return jsonError("运行不存在", 404);
  if (run.status === "running" || run.status === "pending") {
    return jsonError("该运行仍在进行中", 409);
  }
  void continueRun(id, body.data.runId, body.data.prompt).catch(() => {/* 失败态由 executeTurn 落库 */});
  return NextResponse.json({ ok: true }, { status: 200 });
});
