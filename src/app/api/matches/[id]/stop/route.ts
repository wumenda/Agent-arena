import { NextResponse } from "next/server";
import { getRunOfMatch } from "@/lib/db";
import { stopRun } from "@/lib/arena/runner";
import { jsonError, readJson, withMatch } from "@/lib/arena/http";
import { RunIdBodySchema } from "@/lib/arena/types";

// 手动停止对局中的单个 agent（杀进程树；close 后按 failed 落库，error=用户手动停止）
export const POST = withMatch(async ({ req, id }) => {
  const body = await readJson(req, RunIdBodySchema);
  if (!body.ok) return body.res;
  const run = getRunOfMatch(id, body.data.runId);
  if (!run) return jsonError("运行不存在", 404);
  if (run.status !== "running") return jsonError("该 agent 不在运行中", 409);
  const ok = stopRun(body.data.runId);
  if (!ok) return jsonError("停止失败（进程已退出）", 409);
  return NextResponse.json({ ok: true });
});
