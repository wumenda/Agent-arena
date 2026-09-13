import { NextResponse } from "next/server";
import { listRuns, deleteMatch } from "@/lib/db";
import { toRunDTO } from "@/lib/db/schema";
import { jsonError, withMatch } from "@/lib/arena/http";

// runs 输出经 toRunDTO 剥离 workdir：本地文件系统布局不进浏览器
export const GET = withMatch(({ id, match }) => NextResponse.json({ match, runs: listRuns(id).map(toRunDTO) }));

export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = deleteMatch(id);
  if (!result.ok) {
    const status = result.error === "not found" ? 404 : 409;
    return jsonError(result.error ?? "删除失败", status);
  }
  return NextResponse.json({ ok: true });
}
