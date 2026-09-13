import { NextResponse } from "next/server";
import { getComboStats, getHarnessStats, getDailyTrend } from "@/lib/db";

export async function GET() {
  return NextResponse.json({
    stats: getComboStats(),
    byHarness: getHarnessStats(),
    trend: getDailyTrend(14),
  });
}
