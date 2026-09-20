import { mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, type Dirent } from "node:fs";
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

// 产出文件清单短缓存：PreviewCard 切换/轮询/report 会高频调用 listRunFiles（同步递归遍历整个 workdir），
// 短 TTL 缓存避免对相同目录反复全量 stat。key = workdir（路径唯一对应一次 run）
const LIST_CACHE_TTL_MS = 5_000;
const listCache = new Map<string, { at: number; files: RunFileInfo[] }>();

// 递归列出 run 产出文件（排除轨迹文件本身），相对路径统一用 /；5s 内重复调用命中缓存。
// 目录不存在（tmp 被系统清理/手工删除）返回空列表而非抛错——"有 DB 无目录"的历史 run 应显示空产物
export function listRunFiles(workdir: string): RunFileInfo[] {
  const hit = listCache.get(workdir);
  if (hit && Date.now() - hit.at < LIST_CACHE_TTL_MS) return hit.files;
  const out: RunFileInfo[] = [];
  const walk = (d: string) => {
    let entries: Dirent[];
    try {
      entries = readdirSync(d, { withFileTypes: true });
    } catch {
      return; // 子目录不可读/已消失：跳过该子树
    }
    for (const e of entries) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else {
        const rel = path.relative(workdir, full).split(path.sep).join("/");
        if (rel === "trajectory.jsonl" || rel === PREVIEW_URL_FILE) continue; // 内部文件不进产出列表
        try {
          out.push({ path: rel, size: statSync(full).size });
        } catch { /* 文件在遍历间隙被删：跳过 */ }
      }
    }
  };
  walk(workdir);
  out.sort((a, b) => a.path.localeCompare(b.path));
  listCache.set(workdir, { at: Date.now(), files: out });
  return out;
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
// 逐行容错：单行损坏（半行写入是进程被杀/断电的常态）只跳过该行并插入 warn 标记，
// 其余事件照常返回——崩溃后取证恰是最需要回放的时刻，不能整文件 all-or-nothing。
// 走 LRU 缓存：报告/trajectory 路由/UI 补拉会高频读同一文件，全量 readFileSync+JSON.parse 在
// 长轨迹（数千行）下是重复开销；缓存键 = workdir，文件 (mtimeMs, size) 变化即失效（append 写入会触碰 mtime）
const TRAJ_CACHE_MAX = 30; // 缓存条目上限（FIFO 淘汰）
const trajCache = new Map<string, { mtimeMs: number; size: number; events: ArenaEvent[] }>();

export function readTrajectory(workdir: string): ArenaEvent[] {
  const file = path.join(workdir, "trajectory.jsonl");
  try {
    const st = statSync(file);
    const hit = trajCache.get(workdir);
    if (hit && hit.mtimeMs === st.mtimeMs && hit.size === st.size) return hit.events;
    const traj = readFileSync(file, "utf8");
    const events: ArenaEvent[] = [];
    for (const line of traj.split("\n")) {
      if (!line.trim()) continue;
      try {
        events.push(JSON.parse(line) as ArenaEvent);
      } catch {
        events.push({ kind: "warn", text: "[trajectory] 检测到损坏行（可能是写入中断），已跳过", ts: 0 });
      }
    }
    trajCache.set(workdir, { mtimeMs: st.mtimeMs, size: st.size, events });
    if (trajCache.size > TRAJ_CACHE_MAX) {
      const oldest = trajCache.keys().next().value;
      if (oldest != null) trajCache.delete(oldest);
    }
    return events;
  } catch {
    return [];
  }
}

/** 使某 run 的轨迹缓存失效（续聊轮追加事件后 mtime 变化自动失效；删除对局时主动清理） */
export function invalidateTrajectoryCache(workdir: string): void {
  trajCache.delete(workdir);
  listCache.delete(workdir);
}
