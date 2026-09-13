import type { ArenaEvent, Combo, DetectResult, HarnessId } from "../types";
import { claudeCodeAdapter } from "./claude-code";
import { codexAdapter } from "./codex";
import { opencodeAdapter } from "./opencode";
import { traeAdapter } from "./trae";
import { codebuddyAdapter } from "./codebuddy";
import { qoderAdapter } from "./qoder";

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
  /** 直调 .exe 时可关 shell：由 Node 原生转义 argv，规避 cmd 的引号/换行/%VAR% 展开问题（默认 true，兼容 .cmd shim） */
  shell?: boolean;
}

export interface HarnessAdapter {
  id: HarnessId;
  displayName: string;
  models: string[]; // 建议值，UI 允许自由输入
  detect(): Promise<DetectResult>;
  /** prompt 为对局任务原文；不支持 stdin 读取的 harness（如 traecli）经 argv 传入 */
  buildCommand(combo: Combo, workdir: string, prompt?: string): SpawnCommand;
  createParser(): LineParser;
}

export const adapters: Record<string, HarnessAdapter> = {
  [claudeCodeAdapter.id]: claudeCodeAdapter,
  [codexAdapter.id]: codexAdapter,
  [opencodeAdapter.id]: opencodeAdapter,
  [traeAdapter.id]: traeAdapter,
  [codebuddyAdapter.id]: codebuddyAdapter,
  [qoderAdapter.id]: qoderAdapter,
};
