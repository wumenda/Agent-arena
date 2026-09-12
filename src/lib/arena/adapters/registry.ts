import type { ArenaEvent, Combo, DetectResult, HarnessId } from "../types";
import { claudeCodeAdapter } from "./claude-code";
import { codexAdapter } from "./codex";
import { opencodeAdapter } from "./opencode";

export interface LineParser {
  parse(line: string): ArenaEvent[];
  flush?(): ArenaEvent[]; // 流结束时由 runner 调用（codex 的 done 事件在 turn.completed 才有 usage，此时才能发出）
}

export interface SpawnCommand {
  file: string;
  args: string[];
  cwd: string;
  stdin?: string;
  env?: Record<string, string>;
}

export interface HarnessAdapter {
  id: HarnessId;
  displayName: string;
  models: string[]; // 建议值，UI 允许自由输入
  detect(): Promise<DetectResult>;
  buildCommand(combo: Combo, workdir: string): SpawnCommand;
  createParser(): LineParser;
}

export const adapters: Record<string, HarnessAdapter> = {
  [claudeCodeAdapter.id]: claudeCodeAdapter,
  [codexAdapter.id]: codexAdapter,
  [opencodeAdapter.id]: opencodeAdapter,
};
