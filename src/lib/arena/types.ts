import { z } from "zod";

export const HARNESS_IDS = ["claude-code", "codex", "opencode", "trae", "codebuddy", "qoder", "pi"] as const;
export type HarnessId = (typeof HARNESS_IDS)[number];

export const ComboSchema = z.object({
  harness: z.enum(HARNESS_IDS),
  model: z.string().min(1),
});
export type Combo = z.infer<typeof ComboSchema>;

// 题库选题：从题库（内置 questions/ 或用户 .arena/questions/）中选定的一道题，
// 服务端解析为题目目录后开跑时复制进每个运行的工作目录（隔离改同一道题）
export const QuestionRefSchema = z.object({
  bank: z.string().min(1).max(120),
  id: z.string().min(1).max(120),
});
export type QuestionRef = z.infer<typeof QuestionRefSchema>;

export const MatchConfigSchema = z.object({
  prompt: z.string().min(1).max(20000),
  combos: z.array(ComboSchema).min(1).max(24),
  question: QuestionRefSchema.optional(),
  // 单 run 总超时（分钟，可空=用全局 ARENA_TIMEOUT_MS）：个别慢题放宽用
  timeoutMinutes: z.number().int().min(1).max(120).optional(),
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
  | { kind: "user"; text: string; ts: number } // 用户在卡片上追加的提问（续聊入口写入轨迹）
  | { kind: "thinking"; text: string; ts: number }
  | { kind: "tool_call"; tool: string; input: unknown; ts: number }
  | { kind: "tool_result"; tool: string; output: string; isError?: boolean; ts: number }
  | { kind: "file_edit"; path: string; ts: number }
  | { kind: "command"; command: string; exitCode?: number; output?: string; ts: number }
  | { kind: "system"; text: string; ts: number }
  | { kind: "warn"; text: string; ts: number }
  | { kind: "error"; text: string; ts: number }
  | { kind: "done"; usage?: TokenUsage; costUsd?: number; ts: number };

export type RunStatus = "pending" | "running" | "completed" | "failed" | "timeout";

// 服务预览地址黑名单端口：本服务前端自身端口（PORT 环境变量，缺省 3000），
// 可用 ARENA_PREVIEW_PORT_BLACKLIST（逗号分隔端口）追加。命中黑名单的地址不作为服务预览，
// 否则 agent 提到本竞技场自身地址时，iframe 会把竞技场前端渲染进预览卡片
export function previewBlockedPorts(): Set<number> {
  const ports = new Set<number>();
  const selfPort = Number(process.env.PORT ?? 3000);
  if (Number.isInteger(selfPort) && selfPort > 0 && selfPort <= 65535) ports.add(selfPort);
  for (const part of (process.env.ARENA_PREVIEW_PORT_BLACKLIST ?? "").split(",")) {
    const n = Number(part.trim());
    if (Number.isInteger(n) && n > 0 && n <= 65535) ports.add(n);
  }
  return ports;
}

// 服务预览地址：agent 起本地服务后从输出嗅探的本机 URL（UI iframe 直连渲染用）。
// run 与浏览器同机，localhost 即可访问；仅接受 http(s) 本机 host，端口范围与黑名单在 refine 中校验
export const PreviewUrlSchema = z
  .string()
  .regex(/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])(?::\d{1,5})?(?:\/[^\s]*)?$/i, "必须是本机 http(s) 地址")
  .refine((u) => {
    try {
      const url = new URL(u);
      const port = Number(url.port) || (url.protocol === "https:" ? 443 : 80);
      if (port < 1 || port > 65535) return false;
      return !previewBlockedPorts().has(port);
    } catch {
      return false;
    }
  }, "端口超出范围或命中预览黑名单");
export type PreviewUrl = z.infer<typeof PreviewUrlSchema>;
export type DetectResult = { harness: HarnessId; installed: boolean; detail: string; models?: string[] };

// 支持会话续聊的 harness 白名单改由 adapters/meta.ts 从 HARNESS_META 的 continuable 标记派生
// （单一事实来源；本文件保持无 adapter 目录依赖）

// 会话续聊：向已结束的 Run 追加一条用户提问，在同 workdir 继续该会话
export const ContinueRunSchema = z.object({
  runId: z.string().min(1),
  prompt: z.string().min(1).max(20000),
});
export type ContinueRunInput = z.infer<typeof ContinueRunSchema>;

// 仅含 runId 的请求体（手动停止运行 / 清理服务预览共用）
export const RunIdBodySchema = z.object({
  runId: z.string().min(1),
});
export type RunIdBody = z.infer<typeof RunIdBodySchema>;

// 同对局重跑：combos 缺省时全量重跑，指定时部分重跑
export const RerunBodySchema = z.object({
  combos: z.array(ComboSchema).min(1).max(24).optional(),
});
export type RerunBody = z.infer<typeof RerunBodySchema>;

// 视觉对比：对两个运行的产物 HTML 各截一图并做像素对比
export const ScreenshotBodySchema = z.object({
  left: z.object({ runId: z.string().min(1), path: z.string().min(1) }),
  right: z.object({ runId: z.string().min(1), path: z.string().min(1) }),
});
export type ScreenshotBody = z.infer<typeof ScreenshotBodySchema>;
