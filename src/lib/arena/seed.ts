import { cpSync, statSync } from "node:fs";
import path from "node:path";

// 复制题目项目到运行工作目录时排除的顶层目录名（版本库/依赖/运行时数据，大且无对比意义）
const EXCLUDED = new Set([".git", "node_modules", ".arena"]);

// 把题目项目复制进运行工作目录：每个 agent 拿到同一道题的独立副本，隔离修改。
// 失败抛错，由 runner 落库为 failed。
export function seedWorkdir(dir: string, sourceDir: string): void {
  if (!statSync(sourceDir).isDirectory()) {
    throw new Error(`题目路径不是目录: ${sourceDir}`);
  }
  cpSync(sourceDir, dir, {
    recursive: true,
    filter: (src) => {
      const rel = path.relative(sourceDir, src);
      if (!rel) return true; // 源根目录本身
      return !EXCLUDED.has(rel.split(path.sep)[0]);
    },
  });
}
