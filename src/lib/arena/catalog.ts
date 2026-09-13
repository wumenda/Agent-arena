import { HARNESS_META } from "./adapters/meta";

// 客户端安全的 harness 目录，从 meta.ts 单一事实来源派生（避免两处清单漂移）
export const HARNESS_CATALOG = HARNESS_META.map((m) => ({
  id: m.id,
  displayName: m.displayName,
  models: [...m.models],
}));
