import { NextResponse } from "next/server";
import { getRunOfMatch } from "@/lib/db";
import { diffShots } from "@/lib/arena/shot";
import { jsonError, readJson, withMatch } from "@/lib/arena/http";
import { ScreenshotBodySchema } from "@/lib/arena/types";

// POST {left:{runId,path}, right:{runId,path}} → 截两图 + pixelmatch → 三张 base64
export const POST = withMatch(async ({ req, id }) => {
  const body = await readJson(req, ScreenshotBodySchema);
  if (!body.ok) return body.res;
  try {
    const result = await diffShots(id, body.data.left, body.data.right, (runId) => getRunOfMatch(id, runId)?.workdir ?? null);
    if (result === "no-chrome") return jsonError("本机未找到 Chrome/Edge，视觉对比不可用", 501);
    if (!result) return jsonError("运行或产出文件不存在", 404);
    return NextResponse.json(result);
  } catch (err) {
    return jsonError(String(err), 500);
  }
});
