// 前端共享格式化工具（无 React 依赖，可在任意组件中复用）

/** 毫秒 → 简洁时长文案：超过 1 分钟显示 "1m5s"，否则显示 "42.0s" */
export function fmtDuration(ms: number): string {
  return ms > 60000
    ? `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s`
    : `${(ms / 1000).toFixed(1)}s`;
}
