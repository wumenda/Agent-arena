import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { eq, desc, sql } from "drizzle-orm";
import { customAlphabet } from "nanoid";
import { mkdirSync, existsSync, rmSync } from "node:fs";
import path from "node:path";
import { matches, runs, type MatchRow, type RunRow } from "./schema";
import type { Combo } from "@/lib/arena/types";

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

export function createMatch(input: { prompt: string; combos: { harness: string; model: string }[]; status?: string; sourceDir?: string | null }) {
  const id = nanoid();
  db.insert(matches).values({ id, prompt: input.prompt, combos: JSON.stringify(input.combos), status: input.status ?? "pending", sourceDir: input.sourceDir ?? null }).run();
  return getMatch(id)!;
}

export function getMatch(id: string) {
  return db.select().from(matches).where(eq(matches.id, id)).get();
}

// 对局的组合配置：combos 以 JSON 字符串持久化，解析统一在此收口（runner/路由不再各自 JSON.parse）
export function getMatchCombos(id: string): Combo[] {
  const m = getMatch(id);
  return m ? JSON.parse(m.combos) : [];
}

export function listMatches(limit = 200, offset = 0) {
  return db.select().from(matches).orderBy(desc(matches.createdAt)).limit(limit).offset(offset).all();
}

export function countMatches() {
  return db.select({ n: sql<number>`COUNT(*)` }).from(matches).get()!.n;
}

export function createRun(input: { id: string; matchId: string; harness: string; model: string; workdir: string }) {
  db.insert(runs).values({ ...input, status: "pending" }).run();
}

export function getRun(id: string) {
  return db.select().from(runs).where(eq(runs.id, id)).get();
}

// 查询属于指定对局的运行：不存在或不属于该对局一律返回 null（续聊/停止/预览清理/轨迹/文件路由共用）
export function getRunOfMatch(matchId: string, runId: string) {
  const run = getRun(runId);
  return run && run.matchId === matchId ? run : null;
}

/**
 * 启动收敛：服务进程死亡（dev 崩溃/Ctrl+C/机器重启）后 DB 里停留的 running/pending 是"尸体"——
 * 子进程登记随旧进程消失，无法停止也无法重跑（rerunCombos 因 running 拒绝执行，对局死锁）。
 * 服务每次启动时把尸体收敛为 failed，有失败 run 的对局收敛为 partial（completed 只有全绿才成立）。
 * 幂等：无尸体时零写入。返回收敛的 run 数（测试断言用）。
 */
export function reconcileStaleRuns(): number {
  const stale = db.select({ id: runs.id, matchId: runs.matchId }).from(runs)
    .where(sql`${runs.status} IN ('running', 'pending')`).all();
  if (!stale.length) return 0;
  const errText = "服务重启，运行中断（进程未随服务存活），已自动标记失败";
  for (const { id, matchId } of stale) {
    db.update(runs).set({ status: "failed", error: errText, finishedAt: new Date() }).where(eq(runs.id, id)).run();
    // 同对局仍有未收敛的尸体时不急着定对局状态；最后一个收敛完再按全量 runs 判定
    const remaining = listRuns(matchId);
    const allSettled = remaining.every((r) => r.status !== "running" && r.status !== "pending");
    if (allSettled) {
      const allOk = remaining.every((r) => r.status === "completed");
      updateMatch(matchId, { status: allOk ? "completed" : "partial" });
    }
  }
  return stale.length;
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

// 跨对局统计：按 harness×model 聚合（排除未开始的 run）。
// timeout 单列：完成率把"模型太慢被截断"混进"任务失败"，单列超时数让两者可区分（避免把慢误读成完成不了）
export function getComboStats() {
  const rows = db.select({
    harness: runs.harness,
    model: runs.model,
    total: sql<number>`COUNT(*)`,
    completed: sql<number>`SUM(CASE WHEN ${runs.status} = 'completed' THEN 1 ELSE 0 END)`,
    timeouts: sql<number>`SUM(CASE WHEN ${runs.status} = 'timeout' THEN 1 ELSE 0 END)`,
    avgDurationMs: sql<number | null>`AVG(${runs.durationMs})`,
    avgTokensIn: sql<number | null>`AVG(${runs.tokensIn})`,
    avgTokensOut: sql<number | null>`AVG(${runs.tokensOut})`,
    avgCostUsd: sql<number | null>`AVG(${runs.costUsd})`,
  }).from(runs).where(sql`${runs.status} != 'pending'`).groupBy(runs.harness, runs.model).all();
  return rows.sort((a, b) => b.total - a.total);
}

// 跨对局统计：按 harness 汇总（统计页对比条形图，成本为累计花费）；timeouts 同上单列
export function getHarnessStats() {
  return db.select({
    harness: runs.harness,
    total: sql<number>`COUNT(*)`,
    completed: sql<number>`SUM(CASE WHEN ${runs.status} = 'completed' THEN 1 ELSE 0 END)`,
    timeouts: sql<number>`SUM(CASE WHEN ${runs.status} = 'timeout' THEN 1 ELSE 0 END)`,
    avgDurationMs: sql<number | null>`AVG(${runs.durationMs})`,
    totalCostUsd: sql<number | null>`SUM(${runs.costUsd})`,
  }).from(runs).where(sql`${runs.status} != 'pending'`).groupBy(runs.harness).all()
    .sort((a, b) => b.total - a.total);
}

// 近 N 天趋势：按天聚合运行数、完成数与累计成本（startedAt 为空即未启动，不计入）
export function getDailyTrend(days = 14) {
  const dayMs = 86400000;
  const dayKey = (ts: number) => {
    const d = new Date(ts);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };
  const now = Date.now();
  const buckets = new Map<string, { total: number; completed: number; costUsd: number }>();
  for (let i = days - 1; i >= 0; i--) buckets.set(dayKey(now - i * dayMs), { total: 0, completed: 0, costUsd: 0 });
  const cutoff = now - (days - 1) * dayMs;
  const rows = db.select({
    startedAt: runs.startedAt,
    status: runs.status,
    costUsd: runs.costUsd,
  }).from(runs).where(sql`${runs.startedAt} IS NOT NULL AND ${runs.startedAt} >= ${cutoff - dayMs}`).all();
  for (const r of rows) {
    if (r.startedAt == null) continue;
    const key = dayKey(r.startedAt.getTime());
    const b = buckets.get(key);
    if (!b) continue;
    b.total++;
    if (r.status === "completed") b.completed++;
    if (r.costUsd != null) b.costUsd += r.costUsd;
  }
  return [...buckets.entries()].map(([date, b]) => ({ date, ...b }));
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
    // 磁盘布局约定 <root>/<matchId>/<runId>：仅当所有 run 同根且目录名确为该对局 id 时才删，
    // 防止 ARENA_WORKDIR_ROOT 被改过或布局变化后误删无关目录（不满足条件时保守跳过磁盘清理）
    const matchDir = path.dirname(runRows[0].workdir); // <root>/<matchId>
    const consistent = runRows.every((r) => path.dirname(r.workdir) === matchDir);
    if (consistent && path.basename(matchDir) === id) {
      rmSync(matchDir, { recursive: true, force: true });
    }
  }
  return { ok: true };
}
