import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq, desc, sql } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { mkdirSync, existsSync, rmSync } from "node:fs";
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
    CREATE TABLE IF NOT EXISTS matches (id TEXT PRIMARY KEY, prompt TEXT NOT NULL, combos TEXT NOT NULL, source_dir TEXT, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, match_id TEXT NOT NULL, harness TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', error TEXT, workdir TEXT NOT NULL, started_at INTEGER, finished_at INTEGER, duration_ms INTEGER, tokens_in INTEGER, tokens_out INTEGER, cost_usd REAL, verify_status TEXT);
  `);
  // 轻量迁移：旧库补列
  const cols = sqlite.pragma("table_info(matches)") as { name: string }[];
  if (!cols.some((c) => c.name === "parent_match_id")) {
    sqlite.exec("ALTER TABLE matches ADD COLUMN parent_match_id TEXT");
  }
  if (!cols.some((c) => c.name === "source_dir")) {
    sqlite.exec("ALTER TABLE matches ADD COLUMN source_dir TEXT");
  }
  const runCols = sqlite.pragma("table_info(runs)") as { name: string }[];
  if (!runCols.some((c) => c.name === "verify_status")) {
    sqlite.exec("ALTER TABLE runs ADD COLUMN verify_status TEXT");
  }
  return db;
}

const url = process.env.ARENA_DB ?? ".arena/arena.db";
export const db = createDb(url);

const nanoid = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 10);

export function createMatch(input: { prompt: string; combos: { harness: string; model: string }[]; status?: string; parentMatchId?: string; sourceDir?: string | null }) {
  const id = nanoid();
  db.insert(matches).values({ id, prompt: input.prompt, combos: JSON.stringify(input.combos), status: input.status ?? "pending", parentMatchId: input.parentMatchId ?? null, sourceDir: input.sourceDir ?? null }).run();
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

// 血缘链：沿 parentMatchId 向上回溯，最老在前，含自身
export function getLineage(id: string) {
  const chain: MatchRow[] = [];
  let cur = getMatch(id);
  const guard = new Set<string>();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    chain.unshift(cur);
    cur = cur.parentMatchId ? getMatch(cur.parentMatchId) : undefined;
  }
  return chain;
}

// 删除对局：清 runs/matches 行 + 磁盘 workdir 目录；running 中禁止删
export function deleteMatch(id: string): { ok: boolean; error?: string } {
  const match = getMatch(id);
  if (!match) return { ok: false, error: "not found" };
  const runRows = listRuns(id);
  if (runRows.some((r) => r.status === "running" || r.status === "pending")) {
    return { ok: false, error: "match is still running" };
  }
  db.delete(runs).where(eq(runs.matchId, id)).run();
  db.delete(matches).where(eq(matches.id, id)).run();
  if (runRows.length > 0) {
    const matchDir = path.dirname(runRows[0].workdir); // <root>/<matchId>
    rmSync(matchDir, { recursive: true, force: true });
  }
  return { ok: true };
}
