import type { ArenaEvent, Combo } from "../types";
import type { HarnessAdapter, LineParser } from "./registry";
import { runList, runVersion } from "./model-probe";

const now = () => Date.now();

// tool_result 的 result.content 可能是 blocks 数组或字符串，统一抽取文本
function blocksText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const t = content.map((b: any) => (typeof b?.text === "string" ? b.text : "")).filter(Boolean).join("\n");
    if (t) return t;
  }
  return JSON.stringify(content ?? "");
}

// pi --list-models 输出表格（首行表头 provider/model/context/...），
// 数据行取 "provider  model" 两列拼成 --model 接受的 "provider/model"
export function parsePiModels(text: string): string[] {
  const out: string[] = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    const cols = line.trim().split(/\s{2,}/);
    if (cols.length >= 2 && cols[0] && cols[1]) out.push(`${cols[0]}/${cols[1]}`);
  }
  return out;
}

// Task 0 实测（pi 0.85.1，--mode json）：
// - 首行 {"type":"session","version":3,...}，随后 agent/turn/message/tool 事件流（NDJSON）
// - message_end.message.content[] 为块数组：thinking/thinkingSignature、text
// - tool_execution_start{toolCallId,toolName,args} / tool_execution_end{result.content[],isError}
// - message_update 为 delta 流（顶层 usage 为累计值，最后一条即最终用量）
// - agent_end{messages[]} 无 usage 字段 → done 的 usage 取最后记录的 message_update usage；
//   usage.cost.total 为成本（GLM Coding Plan 端点恒 0）
// - agent_settled 为官方文档未列的收尾事件，忽略
// 部署前提：pi 已安装并完成 provider 配置（~/.pi/agent/models.json 支持 "apiKey": "$ARK_API_KEY"
// 环境变量占位符，密钥不落盘）；受限环境（如 Trae 沙箱）下 ~/.pi 不可写时，
// 设 PI_CODING_AGENT_DIR 指向可写目录（runner 以 {...process.env} 继承）
export const piAdapter: HarnessAdapter = {
  id: "pi",
  displayName: "Pi",
  // UI 允许自由输入；pi 的 --model 接受 "provider/model" 形式
  models: ["ark/glm-5.3-flash"],
  detect: async () => {
    // 版本与模型列举并行异步探测（同步 spawn 会阻塞事件循环，期间整站请求排队）
    const [r, list] = await Promise.all([runVersion("pi"), runList("pi", ["--list-models"])]);
    const models = parsePiModels(list);
    return {
      harness: "pi",
      installed: r.ok,
      detail: r.detail,
      models: models.length ? models : undefined,
    };
  },
  // pi bin 为 npm .cmd shim → 走默认 shell:true；
  // prompt 经 stdin 传入（-p 无位置参数时读取管道），规避 cmd 的引号/换行转义问题；
  // --no-session 保持 Run 无状态（会话文件不落 .arena 外的目录）
  buildCommand: (combo: Combo, workdir: string, prompt?: string) => ({
    file: "pi",
    args: ["-p", "--mode", "json", "--no-session", "--model", combo.model],
    cwd: workdir,
    stdin: prompt ?? "",
  }),
  createParser: (): LineParser => {
    // usage 跨行累计：message_update 顶层 usage 与 message_end.message.usage 取最新
    let lastUsage: { input: number; output: number; cacheRead?: number; costTotal?: number } | undefined;
    // 实测一次运行可能有多个 agent_end（retry/子阶段重启 agent 生命周期），done 只发首个
    let doneEmitted = false;
    const parse = (line: string): ArenaEvent[] => {
      let j: any;
      try { j = JSON.parse(line); } catch { return []; }
      const out: ArenaEvent[] = [];
      if (j.type === "session") {
        out.push({ kind: "system", text: `pi session v${j.version ?? "?"}`, ts: now() });
      } else if (j.type === "message_update" && j.usage) {
        lastUsage = {
          input: j.usage.input ?? 0,
          output: j.usage.output ?? 0,
          cacheRead: j.usage.cacheRead || undefined,
          costTotal: j.usage.cost?.total,
        };
      } else if (j.type === "message_end" && j.message?.role === "assistant") {
        const u = j.message.usage;
        if (u) {
          lastUsage = {
            input: u.input ?? lastUsage?.input ?? 0,
            output: u.output ?? lastUsage?.output ?? 0,
            cacheRead: u.cacheRead || lastUsage?.cacheRead,
            costTotal: u.cost?.total ?? lastUsage?.costTotal,
          };
        }
        for (const c of j.message.content ?? []) {
          if (c.type === "thinking" && c.thinking) {
            out.push({ kind: "thinking", text: c.thinking, ts: now() });
          } else if (c.type === "text" && c.text) {
            out.push({ kind: "message", text: c.text, ts: now() });
          }
        }
      } else if (j.type === "tool_execution_start") {
        out.push({ kind: "tool_call", tool: j.toolName ?? "", input: j.args ?? {}, ts: now() });
        if (j.toolName === "write" || j.toolName === "edit") {
          out.push({ kind: "file_edit", path: String(j.args?.path ?? ""), ts: now() });
        }
      } else if (j.type === "tool_execution_end") {
        out.push({
          kind: "tool_result",
          tool: j.toolName ?? "",
          output: blocksText(j.result),
          isError: !!j.isError,
          ts: now(),
        });
      } else if (j.type === "agent_end") {
        if (doneEmitted) return out;
        doneEmitted = true;
        out.push({
          kind: "done",
          usage: lastUsage ? { input: lastUsage.input, output: lastUsage.output, cacheRead: lastUsage.cacheRead } : undefined,
          costUsd: lastUsage?.costTotal,
          ts: now(),
        });
      }
      // agent_start / agent_settled / turn_start / turn_end / message_start：运行期噪音，不入轨迹
      return out;
    };
    return { parse };
  },
};
