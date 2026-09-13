import { mkdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";
import pixelmatch from "pixelmatch";
import { PNG } from "pngjs";
import { safeResolveFile } from "./files";
import type { ScreenshotBody } from "./types";

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe` : "",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean);

// 探测本机 Chrome/Edge；找不到返回 null（视觉 diff 功能降级不可用）
export function findChrome(): string | null {
  return CHROME_CANDIDATES.find((p) => existsSync(p)) ?? null;
}

// 稳定哈希：截图缓存文件名（内容不变不重截）
export function hashKey(...parts: string[]): string {
  let h = 5381;
  for (const s of parts) for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export type ShotResult = { file: string };

// 渲染 HTML 并截图（1280x800）
export async function renderShot(html: string, outFile: string): Promise<ShotResult> {
  const chrome = findChrome();
  if (!chrome) throw new Error("chrome not found");
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setContent(html, { waitUntil: "load", timeout: 20000 });
    await page.screenshot({ path: outFile });
    return { file: outFile };
  } finally {
    await browser.close();
  }
}

const SHOT_DIR = path.join(".arena", "shots");

export type ShotDiffResult = {
  left: string;
  right: string;
  diff: string;
  diffCount: number;
  width: number;
  height: number;
};

/**
 * 视觉对比：对两个运行的产物 HTML 各截一图并做 pixelmatch 像素对比，返回三张 base64。
 * resolveWorkdir 由调用方注入（runId → workdir，run 不存在返回 null），本模块不依赖 db。
 * 文件路径经 safeResolveFile 防穿越；返回 null 表示 run 或文件不存在；"no-chrome" 表示本机无可用浏览器。
 */
export async function diffShots(
  matchId: string,
  left: ScreenshotBody["left"],
  right: ScreenshotBody["right"],
  resolveWorkdir: (runId: string) => string | null,
): Promise<ShotDiffResult | "no-chrome" | null> {
  if (!findChrome()) return "no-chrome";
  const resolveHtml = (side: ScreenshotBody["left"]) => {
    const workdir = resolveWorkdir(side.runId);
    if (!workdir) return null;
    const file = safeResolveFile(workdir, side.path);
    if (!file) return null;
    const raw = readFileSync(file, "utf8");
    return { html: raw, key: hashKey(matchId, side.runId, side.path, String(raw.length)) };
  };
  mkdirSync(SHOT_DIR, { recursive: true });
  const shoot = async (side: ScreenshotBody["left"]) => {
    const r = resolveHtml(side);
    if (!r) return null;
    const outFile = path.join(SHOT_DIR, `${matchId}-${r.key}.png`);
    if (!existsSync(outFile)) await renderShot(r.html, outFile);
    return PNG.sync.read(readFileSync(outFile));
  };
  const a = await shoot(left);
  const b = await shoot(right);
  if (!a || !b) return null;
  const { width, height } = a;
  const diff = new PNG({ width, height });
  const diffCount = pixelmatch(a.data, b.data, diff.data, width, height, { threshold: 0.1 });
  const toB64 = (png: PNG) => PNG.sync.write(png).toString("base64");
  return { left: toB64(a), right: toB64(b), diff: toB64(diff), diffCount, width, height };
}
