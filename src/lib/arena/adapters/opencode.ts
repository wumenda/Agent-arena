import type { ArenaEvent, Combo } from "../types";
import type { HarnessAdapter, LineParser } from "./registry";
import { parseListOutput, runList, runVersion } from "./model-probe";

export const opencodeAdapter: HarnessAdapter = {
  id: "opencode",
  displayName: "OpenCode",
  // 探测失败时的兜底列表（2026-09-13 实测 opencode models 输出；模型 ID 必须带 provider 前缀，裸名会报 Unexpected server error）
  models: ["agentplan/glm-5.3-flash", "volcengine/glm-5-2-260617", "opencode/mimo-v2.5-free"],
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
    // --thinking：让 reasoning part 进 JSON 流（默认被吞掉，思考期 stdout 会长时间静默）
    args: ["run", "-", "--model", combo.model, "--format", "json", "--thinking"],
    cwd: workdir,
    stdin: "__PROMPT__", // runner 会把该占位符替换为对局 prompt
  }),
  // 会话续聊：-c 继续当前 workdir 的最近会话（opencode 会话按目录归档，各 run 工作目录隔离互不干扰）
  buildContinueCommand: (combo: Combo, workdir: string) => ({
    file: "opencode",
    args: ["run", "-", "--continue", "--model", combo.model, "--format", "json", "--thinking"],
    cwd: workdir,
    stdin: "__PROMPT__",
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
        if (j.type === "step_start") {
          // step 边界：不入 UI 对话流（system 被 TrajectoryView 过滤），但写轨迹并喂 runner 静默看门狗
          out.push({ kind: "system", text: "step 开始", ts });
        } else if (j.type === "text" && j.part?.type === "text") {
          out.push({ kind: "message", text: j.part.text ?? "", ts });
        } else if (j.type === "reasoning" && j.part?.type === "reasoning") {
          out.push({ kind: "thinking", text: j.part.text ?? "", ts });
        } else if (j.type === "error") {
          // 出错信封（模型 ID 无法解析时表现为 "Unexpected server error"，进程随即退出码 1）：
          // {"type":"error","error":{"name":"UnknownError","data":{"message":"..."}}}
          const msg = j.error?.data?.message ?? j.error?.message ?? JSON.stringify(j.error ?? j);
          out.push({ kind: "error", text: msg, ts });
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
