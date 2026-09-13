import type { HarnessId } from "../types";

/**
 * harness 元数据单一事实来源（无 node 依赖，客户端组件可安全 import）。
 * adapter 实现的 displayName/models 与 catalog/提示词枚举全部从本表派生；
 * 新增 harness 时在此加一行（id 必须是 types.ts 的 HarnessId，漏改类型会编译报错）。
 */
export type HarnessMeta = {
  id: HarnessId;
  displayName: string;
  models: string[];
  /** 实现了 buildContinueCommand（支持会话续聊）的 harness 标记；与 adapter 实现的一致性由 registry.test 守卫 */
  continuable?: true;
};

export const HARNESS_META: readonly HarnessMeta[] = [
  // 均已接入火山方舟 Agent Plan（glm-5.3-flash，见 .agents/rules/apikey.md）
  { id: "claude-code", displayName: "Claude Code", models: ["glm-5.3-flash", "sonnet", "opus", "haiku"], continuable: true },
  { id: "codex", displayName: "Codex CLI", models: ["glm-5.3-flash", "glm-5.2", "doubao-seed-2.1-turbo"], continuable: true },
  // 2026-09-13 实测：opencode 配置只剩 agentplan provider，ark/glm-5.2 已失效（会报 Unexpected server error）
  { id: "opencode", displayName: "OpenCode", models: ["agentplan/glm-5.3-flash", "volcengine/glm-5-2-260617", "opencode/mimo-v2.5-free"], continuable: true },
  // 闭源 harness（本机 CLI，Task 0 实测）
  { id: "trae", displayName: "Trae CLI", models: ["Doubao-Seed-Evolving"] },
  { id: "codebuddy", displayName: "CodeBuddy", models: ["default-model", "glm-5.3", "glm-5.2", "kimi-k3", "gpt-5.6-sol"] },
  { id: "qoder", displayName: "Qoder CLI", models: ["Qwen3.8-Max"] },
  // 开源（earendil-works/pi，MIT），--mode json 事件流；--model 为 "provider/model" 形式
  { id: "pi", displayName: "Pi", models: ["ark/glm-5.3-flash"] },
];

export function harnessMeta(id: string): HarnessMeta | undefined {
  return HARNESS_META.find((m) => m.id === id);
}

/** 支持会话续聊（实现了 buildContinueCommand）的 harness，从 continuable 标记派生；与 adapter 实现的一致性由 registry.test 守卫 */
export const CONTINUABLE_HARNESSES: readonly HarnessId[] = HARNESS_META
  .filter((m) => m.continuable)
  .map((m) => m.id);
