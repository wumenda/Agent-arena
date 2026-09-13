import type { Combo } from "../types";
import type { HarnessAdapter } from "./registry";
import { createClaudeFamilyParser } from "./claude-family";
import { parseCodebuddyHelp, runList, runVersion } from "./model-probe";

// Task 0 实测（codebuddy 2.150.0，--output-format stream-json）：
// 事件结构与 Claude Code stream-json 完全同构（system/init → assistant → user/tool_result → result），
// 差异点：默认模型 hy4-preview-f；-y 为非交互模式必需（否则授权操作被阻止）；prompt 支持 stdin
export const codebuddyAdapter: HarnessAdapter = {
  id: "codebuddy",
  displayName: "CodeBuddy",
  // Task 0 实测：--model 取值见 codebuddy --help（default-model 即 hy4-preview-f）
  models: ["default-model", "glm-5.3", "glm-5.2", "kimi-k3", "gpt-5.6-sol"],
  detect: async () => {
    // 版本与帮助文本并行异步探测（同步 spawn 会阻塞事件循环，期间整站请求排队）
    const [r, help] = await Promise.all([runVersion("codebuddy"), runList("codebuddy", ["--help"])]);
    // 动态模型：--help 文本内 "Currently supported: (…)" 列出全部支持模型
    const models = parseCodebuddyHelp(help);
    return {
      harness: "codebuddy",
      installed: r.ok,
      detail: r.detail,
      models: models.length ? models : undefined,
    };
  },
  buildCommand: (combo: Combo, workdir: string) => ({
    file: "codebuddy",
    // 无头自动化：-y 跳过权限确认（运行在隔离的临时 workdir，ADR-0001）；prompt 走 stdin
    args: ["-p", "--output-format", "stream-json", "-y", "--model", combo.model],
    cwd: workdir,
    stdin: "__PROMPT__",
  }),
  // 同构族 parser；差异仅在 is_error 时错误详情位于 errors 数组或 result 文本
  createParser: () =>
    createClaudeFamilyParser({
      errorText: (j) => (j.errors ?? []).join("\n") || j.result || "",
    }),
};
