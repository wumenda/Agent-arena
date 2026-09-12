import { spawnSync } from "node:child_process";
import type { ArenaEvent, Combo } from "../types";
import type { HarnessAdapter, LineParser } from "./registry";

const now = () => Date.now();

export const opencodeAdapter: HarnessAdapter = {
  id: "opencode",
  displayName: "OpenCode",
  // Task 0 实测：本机可用模型（opencode models）
  models: ["ark/glm-5.2", "opencode/deepseek-v4-flash-free", "opencode/ling-3.0-flash-free", "opencode/mimo-v2.5-free"],
  detect: async () => {
    const r = spawnSync("opencode", ["--version"], { shell: true, encoding: "utf8" });
    return { harness: "opencode", installed: r.status === 0, detail: (r.stdout || r.stderr || "").trim() };
  },
  buildCommand: (combo: Combo, workdir: string) => ({
    file: "opencode",
    args: ["run", "-", "--model", combo.model, "--format", "json"], // Task 0 实测：支持 --format json
    cwd: workdir,
    stdin: "__PROMPT__", // runner 会把该占位符替换为对局 prompt
  }),
  createParser: (): LineParser => {
    let doneEmitted = false;
    return {
      parse: (line: string): ArenaEvent[] => {
        let j: any;
        try { j = JSON.parse(line); } catch {
          // 非 JSON 行回退为纯文本消息
          return line.trim() ? [{ kind: "message", text: line, ts: now() }] : [];
        }
        const out: ArenaEvent[] = [];
        if (j.type === "text" && j.part?.type === "text") {
          out.push({ kind: "message", text: j.part.text ?? "", ts: now() });
        } else if (j.type === "reasoning" && j.part?.type === "reasoning") {
          out.push({ kind: "thinking", text: j.part.text ?? "", ts: now() });
        } else if ((j.type === "tool_use" || j.type === "tool") && j.part?.type === "tool") {
          // 实测信封为 {"type":"tool_use","part":{"type":"tool","tool":"write","state":{...}}}
          const tool = j.part.tool ?? "";
          out.push({ kind: "tool_call", tool, input: j.part.state?.input ?? null, ts: now() });
          if (["write", "edit", "patch"].includes(tool)) {
            const p = j.part.state?.input?.filePath ?? j.part.state?.metadata?.filepath ?? "";
            if (p) out.push({ kind: "file_edit", path: String(p), ts: now() });
          }
        } else if (j.type === "step_finish") {
          const tokens = j.part?.tokens;
          out.push({
            kind: "done",
            usage: tokens ? { input: tokens.input ?? 0, output: tokens.output ?? 0, cacheRead: tokens.cache?.read } : undefined,
            costUsd: j.part?.cost,
            ts: now(),
          });
          doneEmitted = true;
        }
        return out;
      },
      flush: (): ArenaEvent[] => (doneEmitted ? [] : ((doneEmitted = true), [{ kind: "done", ts: now() }])),
    };
  },
};
