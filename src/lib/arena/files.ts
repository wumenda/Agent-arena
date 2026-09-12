import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const MAX_FILE_BYTES = 1024 * 1024; // 预览上限 1MB

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
        if (rel === "trajectory.jsonl") continue;
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
