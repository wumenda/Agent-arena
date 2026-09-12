import os from "node:os";
import path from "node:path";

// 运行 workdir 根目录（与 runner 一致；独立成模块供删除逻辑复用）
export function workdirRoot() {
  return process.env.ARENA_WORKDIR_ROOT ?? path.join(os.tmpdir(), "model-agent-arena", "runs");
}
