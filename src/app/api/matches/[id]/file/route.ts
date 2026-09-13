import { NextResponse } from "next/server";
import { getRunOfMatch } from "@/lib/db";
import { listRunFiles, readPreviewUrl, readRunFile } from "@/lib/arena/files";
import { jsonError, withMatch } from "@/lib/arena/http";

// ?runId=x            → 产出文件列表 + 服务预览地址（agent 起本地服务时由 runner 嗅探写入）
// ?runId=x&path=y     → 单个文件内容（仅 workdir 内，防穿越）
export const GET = withMatch(({ req, id }) => {
  const runId = req.nextUrl.searchParams.get("runId");
  const run = getRunOfMatch(id, runId ?? "");
  if (!run) return jsonError("运行不存在", 404);
  const filePath = req.nextUrl.searchParams.get("path");
  try {
    if (!filePath) return NextResponse.json({ files: listRunFiles(run.workdir), previewUrl: readPreviewUrl(run.workdir) });
    const file = readRunFile(run.workdir, filePath);
    if (!file) return jsonError("路径越界或文件不存在", 400);
    return NextResponse.json(file);
  } catch {
    return jsonError("文件读取失败", 500);
  }
});
