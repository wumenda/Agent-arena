import { NextResponse } from "next/server";
import { getMatchCombos, listRuns } from "@/lib/db";
import { rerunCombos } from "@/lib/arena/runner";
import { jsonError, readJson, withMatch } from "@/lib/arena/http";
import { RerunBodySchema } from "@/lib/arena/types";

// 重跑：body 可选 {combos:[{harness,model}]}——指定则部分重跑，缺省全量。
// 不再新建对局：直接在本对局内追加 runs，新旧卡片同屏对比。
export const POST = withMatch(async ({ req, id, match }) => {
  // 运行中禁止重跑（与 rerunCombos 内部校验一致，这里提前拦截避免静默无效）
  if (listRuns(id).some((r) => r.status === "running" || r.status === "pending")) {
    return jsonError("对局仍在运行中，暂不能重跑", 409);
  }
  const body = await readJson(req, RerunBodySchema);
  if (!body.ok) return body.res;
  const combos = body.data.combos?.length ? body.data.combos : getMatchCombos(id);
  void rerunCombos(id, combos).catch(() => {/* 路由已立即返回；失败态由 executeRun 落库 */});
  return NextResponse.json({ match }, { status: 200 });
});
