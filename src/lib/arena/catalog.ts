// 客户端安全的 harness 元数据（不含 node 依赖，供 UI 使用；与 adapters 中的定义保持一致）
export const HARNESS_CATALOG: { id: string; displayName: string; models: string[] }[] = [
  { id: "claude-code", displayName: "Claude Code", models: ["sonnet", "opus", "haiku", "sonnet-4-5", "opus-4-1"] },
  { id: "codex", displayName: "Codex CLI", models: ["gpt-5.2-codex", "gpt-5.2", "gpt-5.1-codex", "o4-mini"] },
  // Task 0 实测：本机 opencode 可用模型
  { id: "opencode", displayName: "OpenCode", models: ["ark/glm-5.2", "opencode/deepseek-v4-flash-free", "opencode/ling-3.0-flash-free", "opencode/mimo-v2.5-free"] },
];
