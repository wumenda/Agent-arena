import type { Combo } from "../types";
import type { HarnessAdapter } from "./registry";
import { createClaudeFamilyParser } from "./claude-family";
import { parseClaudeSettingsModels, readHomeFile, runVersion } from "./model-probe";

export const claudeCodeAdapter: HarnessAdapter = {
  id: "claude-code",
  displayName: "Claude Code",
  // 接入火山方舟 Agent Plan（glm-5.3-flash）；sonnet/opus/haiku 别名经 ANTHROPIC_DEFAULT_*_MODEL 映射到同一模型
  models: ["glm-5.3-flash", "sonnet", "opus", "haiku"],
  detect: async () => {
    // 异步探测版本（同步 spawn 会阻塞事件循环，期间整站请求排队）
    const r = await runVersion("claude");
    // 动态模型：~/.claude/settings.json 的 env 映射（ANTHROPIC_MODEL / ANTHROPIC_DEFAULT_*_MODEL）+ 别名
    const settings = readHomeFile(".claude", "settings.json");
    const models = settings ? parseClaudeSettingsModels(settings) : [];
    return {
      harness: "claude-code",
      installed: r.ok,
      detail: r.detail,
      models: models.length ? models : undefined,
    };
  },
  buildCommand: (combo: Combo, workdir: string) => ({
    file: "claude",
    // 无头自动化：跳过权限确认（运行在隔离的临时 workdir，ADR-0001）
    args: ["-p", "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions", "--model", combo.model],
    cwd: workdir,
    // prompt 走 stdin，避免 shell 引号问题（runner 统一替换 __PROMPT__ 占位符）
    stdin: "__PROMPT__",
  }),
  // 会话续聊：-c 继续当前目录的最近会话（claude 会话按目录归档），prompt 仍从 stdin 读
  buildContinueCommand: (combo: Combo, workdir: string) => ({
    file: "claude",
    args: ["-p", "--continue", "--output-format", "stream-json", "--verbose", "--dangerously-skip-permissions", "--model", combo.model],
    cwd: workdir,
    stdin: "__PROMPT__",
  }),
  // stream-json 为 Claude 同构族默认信封（system→assistant→user/tool_result→result），无需差异注入
  createParser: () => createClaudeFamilyParser(),
};
