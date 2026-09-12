import type { ArenaEvent, Combo, DetectResult, HarnessId } from "../types";

export interface LineParser {
  parse(line: string): ArenaEvent[];
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
