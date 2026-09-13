import type { ArenaEvent, Combo } from "../types";
import type { HarnessAdapter, LineParser } from "./registry";
import { parseCodebuddyHelp, runList, runVersion } from "./model-probe";

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
  createParser: (): LineParser => {
    const parse = (line: string): ArenaEvent[] => {
      let j: any;
      try { j = JSON.parse(line); } catch { return []; }
      const out: ArenaEvent[] = [];
      if (j.type === "assistant" && j.message?.content) {
        for (const c of j.message.content) {
          if (c.type === "text") out.push({ kind: "message", text: c.text ?? "", ts: now() });
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
      } else if (j.type === "system") {
        out.push({ kind: "system", text: j.subtype ?? "", ts: now() });
      } else if (j.type === "result") {
        if (j.is_error) {
          out.push({ kind: "error", text: (j.errors ?? []).join("\n") || j.result || "", ts: now() });
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
