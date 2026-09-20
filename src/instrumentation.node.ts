// Node 运行时专用启动逻辑：进程死亡后 DB 里的 running/pending run 是无法停止也无法重跑的尸体
// （子进程登记随旧进程消失），服务实例启动时收敛为 failed，解除对局的"running 死锁"。
// 仅在 NEXT_RUNTIME === "node" 时被 instrumentation.ts require——better-sqlite3 是原生模块，
// 不能进入 edge 运行时的打包图。
export async function register() {
  const { reconcileStaleRuns } = await import("@/lib/db");
  const n = reconcileStaleRuns();
  if (n > 0) console.log(`[arena] 启动收敛：${n} 个中断的 run 已标记为 failed`);
}
