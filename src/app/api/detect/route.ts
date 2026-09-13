import { NextRequest, NextResponse } from "next/server";
import { detectAll } from "@/lib/arena/adapters/registry";

// 探测逻辑与缓存均收口在 registry（detectAll）；路由只做参数透传
export async function GET(req: NextRequest) {
  const force = req.nextUrl.searchParams.get("force") === "1";
  return NextResponse.json({ results: await detectAll(force) });
}
