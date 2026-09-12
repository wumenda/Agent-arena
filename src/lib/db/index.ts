import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq, desc, sql } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";
import { matches, runs, type MatchRow, type RunRow } from "./schema";

function createDb(url: string) {
  if (url !== ":memory:") {
    const dir = path.dirname(url);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  const sqlite = new Database(url);
  sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite);
  // drizzle-kit push 负责建表；此处直接执行 DDL 保证首次可用
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS matches (id TEXT PRIMARY KEY, prompt TEXT NOT NULL, combos TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, match_id TEXT NOT NULL, harness TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', error TEXT, workdir TEXT NOT NULL, started_at INTEGER, finished_at INTEGER, duration_ms INTEGER, tokens_in INTEGER, tokens_out INTEGER, cost_usd REAL);
  `);
  return db;
}

const url = process.env.ARENA_DB ?? ".arena/arena.db";
export const db = createDb(url);

const nanoid = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 10);

export function createMatch(input: { prompt: string; combos: { harness: string; model: string }[]; status?: string }) {
  const id = nanoid();
  db.insert(matches).values({ id, prompt: input.prompt, combos: JSON.stringify(input.combos), status: input.status ?? "pending" }).run();
  return getMatch(id)!;
}

export function getMatch(id: string) {
  return db.select().from(matches).where(eq(matches.id, id)).get();
}

export function listMatches() {
  return db.select().from(matches).orderBy(desc(matches.createdAt)).limit(200).all();
}

export function createRun(input: { id: string; matchId: string; harness: string; model: string; workdir: string }) {
  db.insert(runs).values({ ...input, status: "pending" }).run();
}

export function updateRun(id: string, patch: Partial<RunRow>) {
  db.update(runs).set(patch).where(eq(runs.id, id)).run();
}

export function listRuns(matchId: string) {
  return db.select().from(runs).where(eq(runs.matchId, matchId)).all();
}

export function updateMatch(id: string, patch: Partial<MatchRow>) {
  db.update(matches).set(patch).where(eq(matches.id, id)).run();
}

// 跨对局统计：按 harness×model 聚合（排除未开始的 run）
export function getComboStats() {
  const rows = db.select({
    harness: runs.harness,
    model: runs.model,
    total: sql<number>`COUNT(*)`,
    completed: sql<number>`SUM(CASE WHEN ${runs.status} = 'completed' THEN 1 ELSE 0 END)`,
    avgDurationMs: sql<number | null>`AVG(${runs.durationMs})`,
    avgTokensIn: sql<number | null>`AVG(${runs.tokensIn})`,
    avgTokensOut: sql<number | null>`AVG(${runs.tokensOut})`,
    avgCostUsd: sql<number | null>`AVG(${runs.costUsd})`,
  }).from(runs).where(sql`${runs.status} != 'pending'`).groupBy(runs.harness, runs.model).all();
  return rows.sort((a, b) => b.total - a.total);
}
