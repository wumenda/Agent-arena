import { NextResponse } from "next/server";

// 就绪状态：一句话解析所需密钥是否已配置（只返回布尔，绝不回传密钥本身）。
// 前端首页 readiness 横幅据此提示"配置密钥后才能一句话解析"
export async function GET() {
  const hasCredentials = Boolean(process.env.ARK_BASE_URL && process.env.ARK_API_KEY);
  return NextResponse.json({ hasCredentials });
}
