// 客户端安全的 harness 元数据（不含 node 依赖，供 UI 使用；与 adapters 中的定义保持一致）
export const HARNESS_CATALOG: { id: string; displayName: string; models: string[] }[] = [
  // 均已接入火山方舟 Agent Plan（glm-5.3-flash，见 .agents/rules/apikey.md）
  { id: "claude-code", displayName: "Claude Code", models: ["glm-5.3-flash", "sonnet", "opus", "haiku"] },
  { id: "codex", displayName: "Codex CLI", models: ["glm-5.3-flash", "glm-5.2", "doubao-seed-2.1-turbo"] },
  // Task 0 实测：本机 opencode 可用模型
  { id: "opencode", displayName: "OpenCode", models: ["ark/glm-5.2", "opencode/deepseek-v4-flash-free", "opencode/ling-3.0-flash-free", "opencode/mimo-v2.5-free"] },
  // 闭源 harness（本机 CLI，Task 0 实测）
  { id: "trae", displayName: "Trae CLI", models: ["Doubao-Seed-Evolving"] },
  { id: "codebuddy", displayName: "CodeBuddy", models: ["default-model", "glm-5.3", "glm-5.2", "kimi-k3", "gpt-5.6-sol"] },
  { id: "qoder", displayName: "Qoder CLI", models: ["Qwen3.8-Max"] },
];
