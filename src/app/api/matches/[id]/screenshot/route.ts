import { NextRequest, NextResponse } from "next/server";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { getMatch, listRuns } from "@/lib/db";
import { findChrome, renderShot, hashKey } from "@/lib/arena/shot";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";

const SHOT_DIR = path.join(".arena", "shots");

// POST {left:{runId,path}, right:{runId,path}} → 截两图 + pixelmatch → 三张 base64
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const match = getMatch(id);
  if (!match) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!findChrome()) return NextResponse.json({ error: "本机未找到 Chrome/Edge，视觉对比不可用" }, { status: 501 });
  const body = await req.json();
  const runs = listRuns(id);
  const resolveHtml = (side: { runId: string; path: string }) => {
    const run = runs.find((r) => r.id === side.runId);
    if (!run) throw new Error("run not found");
    const raw = readFileSync(path.join(run.workdir, side.path), "utf8");
    return { html: raw, key: hashKey(id, side.runId, side.path, String(raw.length)) };
  };
  try {
    mkdirSync(SHOT_DIR, { recursive: true });
    const shoot = async (side: { runId: string; path: string }) => {
      const { html, key } = resolveHtml(side);
      const outFile = path.join(SHOT_DIR, `${id}-${key}.png`);
      if (!existsSync(outFile)) await renderShot(html, outFile);
      return PNG.sync.read(readFileSync(outFile));
    };
    const a = await shoot(body.left);
    const b = await shoot(body.right);
    const { width, height } = a;
    const diff = new PNG({ width, height });
    const diffCount = pixelmatch(a.data, b.data, diff.data, width, height, { threshold: 0.1 });
    const toB64 = (png: PNG) => PNG.sync.write(png).toString("base64");
    return NextResponse.json({
      left: toB64(a), right: toB64(b), diff: toB64(diff), diffCount,
      width, height,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
