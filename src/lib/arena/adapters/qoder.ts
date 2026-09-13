import type { ArenaEvent, Combo } from "../types";
import type { HarnessAdapter, LineParser } from "./registry";
import { parseListOutput, runList, runVersion } from "./model-probe";

const now = () => Date.now();

// tool_result 的 content 可能是字符串或 content blocks 数组，统一抽取文本
function blocksText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const t = content.map((b: any) => (typeof b?.text === "string" ? b.text : "")).filter(Boolean).join("\n");
    if (t) return t;
  }
  return JSON.stringify(content ?? "");
}

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
  createParser: (): LineParser => {
    // result 行可能不带 errors/result 字段（错误详情在 synthetic assistant 消息里），兜底取最后一条 assistant 文本
    let lastText = "";
    const parse = (line: string): ArenaEvent[] => {
      let j: any;
      try { j = JSON.parse(line); } catch { return []; }
      const out: ArenaEvent[] = [];
      if (j.type === "system" && j.subtype === "init") {
        out.push({ kind: "system", text: `init qodercli=${j.qodercli_version}`, ts: now() });
      } else if (j.type === "assistant" && j.message?.content) {
        for (const c of j.message.content) {
          if (c.type === "text") {
            if (c.text) lastText = c.text;
            out.push({ kind: "message", text: c.text ?? "", ts: now() });
          }
          if (c.type === "thinking") out.push({ kind: "thinking", text: c.thinking ?? "", ts: now() });
          if (c.type === "tool_use") {
            out.push({ kind: "tool_call", tool: c.name, input: c.input, ts: now() });
            if (c.name === "Write" || c.name === "Edit") {
              out.push({ kind: "file_edit", path: String(c.input?.file_path ?? ""), ts: now() });
            }
          }
        }
      } else if (j.type === "user" && j.message?.content) {
        for (const c of j.message.content) {
          if (c.type === "tool_result") {
            out.push({
              kind: "tool_result",
              tool: "",
              output: blocksText(c.content),
              isError: !!c.is_error,
              ts: now(),
            });
          }
        }
      } else if (j.type === "result") {
        if (j.is_error) {
          out.push({ kind: "error", text: (j.errors ?? []).join("\n") || j.result || lastText, ts: now() });
        }
        out.push({
          kind: "done",
          usage: j.usage ? {
            input: j.usage.input_tokens ?? 0,
            output: j.usage.output_tokens ?? 0,
            cacheRead: j.usage.cache_read_input_tokens ?? undefined,
          } : undefined,
          costUsd: j.total_cost_usd,
          ts: now(),
        });
      }
      return out;
    };
    return { parse };
  },
};
