import type { Combo } from "../types";
import type { HarnessAdapter } from "./registry";
import { createClaudeFamilyParser } from "./claude-family";
import { parseListOutput, runList, runVersion } from "./model-probe";

// Task 0 实测（qodercli 1.1.51，-o stream-json / -o json）：
// 事件结构为 Claude Code 同构族（system/init → assistant → user/tool_result → result）。
// 与 CodeBuddy 的差异：额外有 artifacts_update / hook_started / hook_progress / hook_response
// 等 system 子类型（运行期噪音，不入轨迹）。
// 注意：采样时账户额度耗尽（synthetic 助手消息 + error_during_execution），
// tool_use/tool_result 真实样本未采到，解析路径按同族约定实现，额度恢复后应跑真实对局复核。
export const qoderAdapter: HarnessAdapter = {
  id: "qoder",
  displayName: "Qoder CLI",
  // Task 0 实测：--list-models 当前仅返回 Qwen3.8-Max（UI 允许自由输入其他模型标识）
  models: ["Qwen3.8-Max"],
  detect: async () => {
    // 版本与模型列举并行异步探测（同步 spawn 会阻塞事件循环，期间整站请求排队）
    const [r, list] = await Promise.all([runVersion("qodercli"), runList("qodercli", ["--list-models"])]);
    const models = parseListOutput(list);
    return {
      harness: "qoder",
      installed: r.ok,
      detail: r.detail,
      models: models.length ? models : undefined,
    };
  },
  // prompt 走 argv（实测可达模型调用）；qodercli 为真 .exe，关 shell 由 Node 原生转义
  buildCommand: (combo: Combo, workdir: string, prompt?: string) => ({
    file: "qodercli",
    args: ["-p", prompt ?? "", "-o", "stream-json", "--dangerously-skip-permissions", "-m", combo.model],
    cwd: workdir,
    shell: false,
  }),
  // 同构族 parser；差异：仅 init 子类型入轨迹（hook_* 噪音丢弃）、is_error 兜底取最后一条 assistant 文本
  createParser: () =>
    createClaudeFamilyParser({
      systemEvents: (j) => (j.subtype === "init" ? [{ text: `init qodercli=${j.qodercli_version}` }] : []),
      // result 行可能不带 errors/result 字段（错误详情在 synthetic assistant 消息里）
      errorText: (j, lastText) => (j.errors ?? []).join("\n") || j.result || lastText,
    }),
};
