import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// 对局：一次提交的完整实验（同一条 prompt × 一组组合）
export const matches = sqliteTable("matches", {
  id: text("id").primaryKey(), // nanoid
  prompt: text("prompt").notNull(),
  combos: text("combos").notNull(), // JSON: {harness, model}[]
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
});

export type MatchRow = typeof matches.$inferSelect;
export type RunRow = typeof runs.$inferSelect;
