import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// 对局：一次提交的完整实验（同一条 prompt × 一组组合）
export const matches = sqliteTable("matches", {
  id: text("id").primaryKey(), // nanoid
  prompt: text("prompt").notNull(),
  combos: text("combos").notNull(), // JSON: {harness, model}[]
  sourceDir: text("source_dir"), // 题目项目源目录（可选）：开跑时复制进每个运行的工作目录
  status: text("status").notNull().default("pending"), // pending|running|completed|partial
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

// 运行：对局中单个「harness × 模型」组合的一次执行
export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  matchId: text("match_id").notNull(),
  harness: text("harness").notNull(),
  model: text("model").notNull(),
  status: text("status").notNull().default("pending"), // pending|running|completed|failed|timeout
  error: text("error"),
  workdir: text("workdir").notNull(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  durationMs: integer("duration_ms"),
  tokensIn: integer("tokens_in"),
  tokensOut: integer("tokens_out"),
  costUsd: real("cost_usd"),
  verifyStatus: text("verify_status"), // 修复验证：passed|failed|skipped（题目带测试套件时才有值）
});

export type MatchRow = typeof matches.$inferSelect;
export type RunRow = typeof runs.$inferSelect;

/** 浏览器可见的运行 DTO：剥离 workdir 绝对路径（本地文件系统布局不外泄，UI 与 DB schema 解耦） */
export type RunDTO = Omit<RunRow, "workdir">;
export function toRunDTO(run: RunRow): RunDTO {
  return { ...run }; // spread 不触发多余属性检查，workdir 被返回类型自然排除
}
