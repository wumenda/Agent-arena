import type { ArenaEvent, Combo } from "../types";
import type { HarnessAdapter, LineParser } from "./registry";
import { parseListOutput, runList, runVersion } from "./model-probe";

const now = () => Date.now();

export const opencodeAdapter: HarnessAdapter = {
  id: "opencode",
  displayName: "OpenCode",
  // Task 0 实测：本机可用模型（opencode models）
  models: ["ark/glm-5.2", "opencode/deepseek-v4-flash-free", "opencode/ling-3.0-flash-free", "opencode/mimo-v2.5-free"],
  detect: async () => {
    // 版本与模型列举并行异步探测（同步 spawn 会阻塞事件循环，期间整站请求排队）
    const [r, list] = await Promise.all([runVersion("opencode"), runList("opencode", ["models"])]);
    const models = parseListOutput(list);
    return {
      harness: "opencode",
      installed: r.ok,
      detail: r.detail,
      models: models.length ? models : undefined,
    };
  },
  buildCommand: (combo: Combo, workdir: string) => ({
    file: "opencode",
    args: ["run", "-", "--model", combo.model, "--format", "json"], // Task 0 实测：支持 --format json
    cwd: workdir,
    stdin: "__PROMPT__", // runner 会把该占位符替换为对局 prompt
  }),
  createParser: (): LineParser => {
    // step_finish 每个 LLM step 报一次本次调用的 usage：跨 step 累加，flush 时发唯一 done。
    // 不能"最后一次覆盖"——收尾空转 step 的 output=0 会把真实生成量清零。
    let acc: { input: number; output: number; cacheRead: number } | null = null;
    return {
      parse: (line: string): ArenaEvent[] => {
        let j: any;
        try { j = JSON.parse(line); } catch {
          // 非 JSON 行回退为纯文本消息
          return line.trim() ? [{ kind: "message", text: line, ts: Date.now() }] : [];
        }
        const ts = Date.now();
        const out: ArenaEvent[] = [];
        if (j.type === "text" && j.part?.type === "text") {
          out.push({ kind: "message", text: j.part.text ?? "", ts });
        } else if (j.type === "reasoning" && j.part?.type === "reasoning") {
          out.push({ kind: "thinking", text: j.part.text ?? "", ts });
        } else if ((j.type === "tool_use" || j.type === "tool") && j.part?.type === "tool") {
          // 实测信封为 {"type":"tool_use","part":{"type":"tool","tool":"write","state":{...}}}
          const tool = j.part.tool ?? "";
          out.push({ kind: "tool_call", tool, input: j.part.state?.input ?? null, ts });
          if (["write", "edit", "patch"].includes(tool)) {
            const p = j.part.state?.input?.filePath ?? j.part.state?.metadata?.filepath ?? "";
            if (p) out.push({ kind: "file_edit", path: String(p), ts });
          }
        } else if (j.type === "step_finish") {
          const tokens = j.part?.tokens;
          if (tokens) {
            acc ??= { input: 0, output: 0, cacheRead: 0 };
            acc.input += tokens.input ?? 0;
            acc.output += tokens.output ?? 0;
            acc.cacheRead += tokens.cache?.read ?? 0;
          }
        }
        return out;
      },
      flush: (): ArenaEvent[] => [{ kind: "done", usage: acc ?? undefined, ts: Date.now() }],
    };
  },
};
