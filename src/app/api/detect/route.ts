import { NextRequest, NextResponse } from "next/server";
import { adapters } from "@/lib/arena/adapters/registry";

// 探测结果短缓存：探测要起多个 CLI 子进程（虽已异步化不阻塞事件循环，但仍避免每次进页面都重复起进程）
// 「重新探测」按钮传 ?force=1 绕过缓存（ccswitch 切换供应商后需强制刷新）
const TTL_MS = 30_000;
let cache: { at: number; results: unknown } | null = null;

export async function GET(req: NextRequest) {
  const force = req.nextUrl.searchParams.get("force") === "1";
  if (!force && cache && Date.now() - cache.at < TTL_MS) {
    return NextResponse.json({ results: cache.results });
  }
  const results = await Promise.all(Object.values(adapters).map((a) => a.detect()));
  cache = { at: Date.now(), results };
  return NextResponse.json({ results });
}
