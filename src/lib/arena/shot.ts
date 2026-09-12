import { existsSync } from "node:fs";
import puppeteer from "puppeteer-core";

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
