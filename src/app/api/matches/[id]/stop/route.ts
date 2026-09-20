import { NextResponse } from "next/server";
import { getRunOfMatch, updateRun } from "@/lib/db";
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
  if (!ok) {
    // DB 显示 running 但进程登记查不到：服务重启导致进程失联（instrumentation 收敛前的窗口）。
    // 直接标记失败给用户一个收拾残局的出口，而不是返回误导性的"不在运行中"
    updateRun(run.id, { status: "failed", error: "进程已失联（服务可能重启过），已强制标记失败", finishedAt: new Date() });
    return jsonError("进程已失联，该运行已标记为失败", 409);
  }
  return NextResponse.json({ ok: true });
});
