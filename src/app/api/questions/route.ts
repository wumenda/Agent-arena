import { NextResponse } from "next/server";
import { listBanks } from "@/lib/arena/questions";

// 题库列表：内置题库 + 用户自放题库（.arena/questions），供配置表单级联选择
export async function GET() {
  return NextResponse.json({ banks: listBanks() });
}
