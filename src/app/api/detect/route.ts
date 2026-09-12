import { NextResponse } from "next/server";
import { adapters } from "@/lib/arena/adapters/registry";

export async function GET() {
  const results = await Promise.all(Object.values(adapters).map((a) => a.detect()));
  return NextResponse.json({ results });
}
