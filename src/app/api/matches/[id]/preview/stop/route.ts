import { NextResponse } from "next/server";
import { getRunOfMatch } from "@/lib/db";
import { jsonError, readJson, withMatch } from "@/lib/arena/http";
import { RunIdBodySchema } from "@/lib/arena/types";
import { clearPreviewUrl, previewUrlPort, readPreviewUrl } from "@/lib/arena/files";
import { killPortListeners } from "@/lib/arena/proc";

// 清理该 run 的本地服务：杀掉预览端口上的监听进程（排除自身），并清除预览地址文件。
// 服务未存活也照常清文件（killed=0），UI 回退到 HTML 文件预览
export const POST = withMatch(async ({ req, id }) => {
  const body = await readJson(req, RunIdBodySchema);
  if (!body.ok) return body.res;
  const run = getRunOfMatch(id, body.data.runId);
  if (!run) return jsonError("运行不存在", 404);
  const url = readPreviewUrl(run.workdir);
  if (!url) return jsonError("该运行没有服务预览地址", 409);
  const port = previewUrlPort(url);
  const killed = port ? await killPortListeners(port) : 0;
  clearPreviewUrl(run.workdir);
  return NextResponse.json({ ok: true, killed });
});
