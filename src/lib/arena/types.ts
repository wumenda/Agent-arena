import { z } from "zod";

export const HARNESS_IDS = ["claude-code", "codex", "opencode"] as const;
export type HarnessId = (typeof HARNESS_IDS)[number];

export const ComboSchema = z.object({
  harness: z.enum(HARNESS_IDS),
  model: z.string().min(1),
});
export type Combo = z.infer<typeof ComboSchema>;

export const MatchConfigSchema = z.object({
  prompt: z.string().min(1).max(20000),
  combos: z.array(ComboSchema).min(1).max(24),
});
export type MatchConfig = z.infer<typeof MatchConfigSchema>;

export type TokenUsage = { input: number; output: number; cacheRead?: number };

export type RunMetrics = {
  durationMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
};

// 归一化事件：所有 adapter 的输出都翻译成这一种形状
export type ArenaEvent =
  | { kind: "message"; text: string; ts: number }
  | { kind: "thinking"; text: string; ts: number }
  | { kind: "tool_call"; tool: string; input: unknown; ts: number }
  | { kind: "tool_result"; tool: string; output: string; isError?: boolean; ts: number }
  | { kind: "file_edit"; path: string; ts: number }
  | { kind: "command"; command: string; exitCode?: number; output?: string; ts: number }
  | { kind: "system"; text: string; ts: number }
  | { kind: "error"; text: string; ts: number }
  | { kind: "done"; usage?: TokenUsage; costUsd?: number; ts: number };

export type RunStatus = "pending" | "running" | "completed" | "failed" | "timeout";
export type DetectResult = { harness: HarnessId; installed: boolean; detail: string };
