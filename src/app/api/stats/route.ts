import { NextResponse } from "next/server";
import { getComboStats } from "@/lib/db";

export async function GET() {
  return NextResponse.json({ stats: getComboStats() });
}
