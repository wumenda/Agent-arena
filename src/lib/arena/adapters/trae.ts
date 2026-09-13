import type { ArenaEvent, Combo } from "../types";
import type { HarnessAdapter, LineParser } from "./registry";
import { parseListOutput, runList, runVersion } from "./model-probe";

const now = () => Date.now();

// tool_calls[].function.arguments 是 JSON 字符串（OpenAI 风格），解析失败时保留原文
function safeParseArgs(raw: string | undefined): Record<string, unknown> {
  if (!raw) return {};
  try { return JSON.parse(raw); } catch { return { _raw: raw }; }
}

// Task 0 实测（traecli 0.120.52，--output-format stream-json）：
// - system/init：含 model、permission_mode、tools 快照
// - system/status：运行期噪音（reminders/上下文更新，频率高），不入轨迹
// - assistant：message.content 是纯字符串（非 content blocks）；思考在 message.reasoning_content；
//   工具调用在 message.tool_calls[]（id/name/arguments）
// - user/subtype=tool_result：tool_use_id + tool_name + content.content[].text + content.is_error
// - result：usage.input_tokens/output_tokens/cache_read_input_tokens + total_cost_usd；
//   出错时 subtype=error_during_execution 且 NDJSON 流仍完整（result 恒为末行）
export const traeAdapter: HarnessAdapter = {
  id: "trae",
  displayName: "Trae CLI",
  // Task 0 实测：登录后内置模型（交互模式 /model 可见；UI 允许自由输入）
  models: ["Doubao-Seed-Evolving"],
  detect: async () => {
    // 版本与模型列举并行异步探测（同步 spawn 会阻塞事件循环，期间整站请求排队）
    const [r, list] = await Promise.all([runVersion("traecli"), runList("traecli", ["models"])]);
    const models = parseListOutput(list);
    return {
      harness: "trae",
      installed: r.ok,
      detail: r.detail,
      models: models.length ? models : undefined,
    };
  },
  // 官方文档：traecli -p 不读取 stdin，prompt 必须是第一个位置参数；
  // 模型经 -c "model.name=..." 覆盖（Task 0 实测有效）。
  // traecli 为真 .exe，关 shell 由 Node 原生转义 argv（多行/引号/中文安全）
  buildCommand: (combo: Combo, workdir: string, prompt?: string) => ({
    file: "traecli",
    args: ["-p", prompt ?? "", "--output-format", "stream-json", "-y", "-c", `model.name=${combo.model}`],
    cwd: workdir,
    shell: false,
  }),
  createParser: (): LineParser => {
    return {
      parse: (line: string): ArenaEvent[] => {
        let j: any;
        try { j = JSON.parse(line); } catch { return []; }
        const out: ArenaEvent[] = [];
        if (j.type === "system" && j.subtype === "init") {
          out.push({ kind: "system", text: `init model=${j.model} permission=${j.permission_mode}`, ts: now() });
        } else if (j.type === "assistant" && j.message) {
          const m = j.message;
          if (m.reasoning_content) out.push({ kind: "thinking", text: m.reasoning_content, ts: now() });
          if (typeof m.content === "string" && m.content) {
            out.push({ kind: "message", text: m.content, ts: now() });
          }
          for (const tc of m.tool_calls ?? []) {
            const name = tc.function?.name ?? "";
            const input = safeParseArgs(tc.function?.arguments);
            out.push({ kind: "tool_call", tool: name, input, ts: now() });
            if (name === "Write" || name === "Edit") {
              out.push({ kind: "file_edit", path: String(input.file_path ?? ""), ts: now() });
            }
          }
        } else if (j.type === "user" && j.subtype === "tool_result") {
          const c = j.content ?? {};
          const blocks = Array.isArray(c.content) ? c.content : [];
          const text = blocks.map((b: any) => b?.text ?? "").filter(Boolean).join("\n")
            || (typeof c.content === "string" ? c.content : JSON.stringify(c));
          out.push({
            kind: "tool_result",
            tool: j.tool_name ?? "",
            output: text,
            isError: !!(c.is_error ?? j.is_error),
            ts: now(),
          });
        } else if (j.type === "result") {
          if (j.is_error) {
            out.push({ kind: "error", text: j.error ?? j.result ?? "", ts: now() });
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
      },
    };
  },
};
