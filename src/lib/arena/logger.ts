import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";

// 轻量日志落盘：.arena/arena.log（个人工具，不做轮转/分级）。
// 用途：服务崩溃、run 失败/超时/停止、启动收敛等无法只靠 DB/trajectory 追溯的事件。
// 不记录密钥、不记录 prompt 全文（含敏感信息的字段由调用方决定是否传入）。
const LOG_DIR = process.env.ARENA_DB ? path.dirname(process.env.ARENA_DB) : ".arena";

export function logArena(event: string, fields?: Record<string, unknown>): void {
  try {
    const line = JSON.stringify({
      ts: new Date().toISOString(),
      event,
      ...fields,
    });
    mkdirSync(LOG_DIR, { recursive: true });
    appendFileSync(path.join(LOG_DIR, "arena.log"), line + "\n");
  } catch {
    // 日志失败不影响主流程
  }
}
