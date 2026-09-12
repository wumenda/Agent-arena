import { NextRequest, NextResponse } from "next/server";
import { parseNaturalLanguage } from "@/lib/arena/parser";

export async function POST(req: NextRequest) {
  const { input } = await req.json();
  if (typeof input !== "string" || !input.trim()) {
    return NextResponse.json({ error: "input required" }, { status: 400 });
  }
  const config = await parseNaturalLanguage(input);
  return NextResponse.json({ config }); // config 可能为 null，前端回退手动表单
}
