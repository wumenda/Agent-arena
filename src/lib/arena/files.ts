import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { PreviewUrlSchema, type ArenaEvent } from "./types";

export const MAX_FILE_BYTES = 1024 * 1024; // 预览上限 1MB

// 服务预览约定文件：agent 在 run 中起本地服务时，runner 从输出嗅探 URL 写入此文件，UI iframe 直连渲染。
// 放 .arena/ 内部目录（运行时数据约定），不进产出文件列表
export const PREVIEW_URL_FILE = ".arena/preview-url";

// 提示词追加约定：引导 agent 后台起服务，并把最终 URL 写进最终回复文本（嗅探只匹配模型 message 输出）
export const PREVIEW_PROMPT_HINT =
  "\n\n补充约定：若需要以本地服务形式预览成果，请在后台启动服务（不要阻塞前台），把最终可访问的 URL（如 http://localhost:3000）明确写进你的最终回复文本中，并保持服务运行到任务结束。";

// 本机 URL 嗅探：host 限定 localhost/127.0.0.1/0.0.0.0/[::1]，后跟 (?![\w.:]) 防止
// 误匹配伪装域名（如 localhost.evil.com）与截断端口（如 :3000.evil.com）
const PREVIEW_URL_RE = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0|\[::1\])(?::\d{1,5})?(?:\/[^\s<>"'`]*)?(?![\w.:])/gi;

// 从一段输出文本中提取第一个本机服务 URL；0.0.0.0 归一化为 localhost，剔除尾部粘连标点。
// 非本机地址 / 非法端口 / 无法解析一律返回 null（经 PreviewUrlSchema 校验）
export function extractPreviewUrl(text: string): string | null {
  PREVIEW_URL_RE.lastIndex = 0;
  const m = PREVIEW_URL_RE.exec(text);
  if (!m) return null;
  let url = m[0].replace(/[\.,;:!\)\]}'”，。；：！？、）】]+$/, "");
  url = url.replace(/^(https?):\/\/0\.0\.0\.0(?=:)/i, "$1://localhost");
  return PreviewUrlSchema.safeParse(url).success ? url : null;
}

// 嗅探到新地址时写入（内容不变不重写，避免无谓 IO）
export function savePreviewUrl(workdir: string, url: string): void {
  const file = path.join(workdir, PREVIEW_URL_FILE);
  try {
    if (readFileSync(file, "utf8") === url) return;
  } catch {
    /* 首次写入 */
  }
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, url);
}

// 读取预览地址；文件缺失或内容不合法返回 null
export function readPreviewUrl(workdir: string): string | null {
  try {
    const raw = readFileSync(path.join(workdir, PREVIEW_URL_FILE), "utf8").trim();
    return PreviewUrlSchema.safeParse(raw).success ? raw : null;
  } catch {
    return null;
  }
}

// 从预览地址解析端口；无显式端口（默认 80/443）或非法 URL 返回 null
export function previewUrlPort(url: string): number | null {
  try {
    const p = new URL(url).port;
    return p ? Number(p) : null;
  } catch {
    return null;
  }
}

// 清除预览地址文件（服务被结束后调用，UI 回退到 HTML 文件预览）；文件不存在时静默
export function clearPreviewUrl(workdir: string): void {
  try {
    rmSync(path.join(workdir, PREVIEW_URL_FILE), { force: true });
  } catch {
    /* 忽略 */
  }
}

// 安全解析：relPath 解析后必须位于 workdir 内（防路径穿越）；返回 null 表示非法
export function safeResolveFile(workdir: string, relPath: string): string | null {
  const wd = path.resolve(workdir);
  const resolved = path.resolve(wd, relPath);
  if (resolved !== wd && !resolved.startsWith(wd + path.sep)) return null;
  return resolved;
}

export type RunFileInfo = { path: string; size: number };

// 递归列出 run 产出文件（排除轨迹文件本身），相对路径统一用 /
export function listRunFiles(workdir: string): RunFileInfo[] {
  const out: RunFileInfo[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else {
        const rel = path.relative(workdir, full).split(path.sep).join("/");
        if (rel === "trajectory.jsonl" || rel === PREVIEW_URL_FILE) continue; // 内部文件不进产出列表
        out.push({ path: rel, size: statSync(full).size });
      }
    }
  };
  walk(workdir);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

// 读取文件内容（超 1MB 截断）
export function readRunFile(workdir: string, relPath: string): { content: string; truncated: boolean; size: number } | null {
  const resolved = safeResolveFile(workdir, relPath);
  if (!resolved) return null;
  const size = statSync(resolved).size;
  const content = readFileSync(resolved, "utf8").slice(0, MAX_FILE_BYTES);
  return { content, truncated: size > MAX_FILE_BYTES, size };
}

// 读取运行轨迹（trajectory.jsonl）并逐行解析为 ArenaEvent[]；
// 文件缺失或单行损坏按尽力而为语义兜底空数组（轨迹属运行时数据，不因读取失败阻塞响应）
export function readTrajectory(workdir: string): ArenaEvent[] {
  try {
    const traj = readFileSync(path.join(workdir, "trajectory.jsonl"), "utf8");
    return traj.split("\n").filter(Boolean).map((l) => JSON.parse(l) as ArenaEvent);
  } catch {
    return [];
  }
}
