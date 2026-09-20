// 服务启动钩子（Next instrumentation 约定，见 node_modules/next/dist/docs/01-app/02-guides/instrumentation.md）。
// instrumentation 在 Node 与 Edge 两个运行时都会打包，原生模块依赖（better-sqlite3）只能进 node 图——
// 按 NEXT_RUNTIME 分流（注意 Node 侧的值是 'nodejs'），edge 运行时为 no-op
export function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    return import("./instrumentation.node").then((m) => m.register());
  }
}
