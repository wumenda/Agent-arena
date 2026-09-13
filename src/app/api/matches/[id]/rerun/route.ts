import { NextRequest, NextResponse } from "next/server";
import { getMatch, listRuns } from "@/lib/db";
import { rerunCombos } from "@/lib/arena/runner";
import { MatchConfigSchema } from "@/lib/arena/types";
import type { Combo } from "@/lib/arena/types";

// 重跑：body 可选 {combos:[{harness,model}]}——指定则部分重跑，缺省全量。
// 不再新建对局：直接在本对局内追加 runs，新旧卡片同屏对比。
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const match = getMatch(id);
  if (!match) return NextResponse.json({ error: "not found" }, { status: 404 });
  // 运行中禁止重跑（与 rerunCombos 内部校验一致，这里提前拦截避免静默无效）
  if (listRuns(id).some((r) => r.status === "running" || r.status === "pending")) {
    return NextResponse.json({ error: "对局仍在运行中，暂不能重跑" }, { status: 409 });
  }
  const body = await req.json().catch(() => ({}));
  let combos = JSON.parse(match.combos) as Combo[];
  if (Array.isArray(body?.combos) && body.combos.length > 0) {
    const parsed = MatchConfigSchema.pick({ combos: true }).safeParse({ combos: body.combos });
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    combos = parsed.data.combos;
  }
  void rerunCombos(id, combos).catch(() => {/* 路由已在下方立即返回；失败态由 executeRun 落库 */});
  return NextResponse.json({ match }, { status: 200 });
}
