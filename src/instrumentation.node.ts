// Node 运行时专用启动逻辑：进程死亡后 DB 里的 running/pending run 是无法停止也无法重跑的尸体
// （子进程登记随旧进程消失），服务实例启动时收敛为 failed，解除对局的"running 死锁"；
// 顺带按 ARENA_KEEP_WORKDIR_DAYS 清理超期的已结束对局 workdir（默认 0=不清理，防 .arena/ 只增不减）。
// 仅在 NEXT_RUNTIME === "nodejs" 时被 instrumentation.ts require——better-sqlite3 是原生模块，
// 不能进入 edge 运行时的打包图。
export async function register() {
  const { reconcileStaleRuns, cleanupStaleWorkdirs } = await import("@/lib/db");
  const n = reconcileStaleRuns();
  if (n > 0) console.log(`[arena] 启动收敛：${n} 个中断的 run 已标记为 failed`);
  const keepDays = Number(process.env.ARENA_KEEP_WORKDIR_DAYS ?? 0);
  if (Number.isFinite(keepDays) && keepDays > 0) {
    const removed = cleanupStaleWorkdirs(keepDays);
    if (removed > 0) console.log(`[arena] 已清理 ${removed} 个超期 workdir（保留 ${keepDays} 天）`);
    // 视觉对比截图缓存随同一保留策略清理（PNG 按 matchId 前缀命名）
    const { cleanupShots } = await import("@/lib/arena/shot");
    const removedShots = cleanupShots(keepDays);
    if (removedShots > 0) console.log(`[arena] 已清理 ${removedShots} 个超期截图缓存`);
  }
}
