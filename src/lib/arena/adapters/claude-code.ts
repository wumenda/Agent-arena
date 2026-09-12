import { spawnSync } from "node:child_process";
import type { ArenaEvent, Combo } from "../types";
import type { HarnessAdapter, LineParser } from "./registry";

const now = () => Date.now();

export const claudeCodeAdapter: HarnessAdapter = {
  id: "claude-code",
  displayName: "Claude Code",
  models: ["sonnet", "opus", "haiku", "sonnet-4-5", "opus-4-1"],
  detect: async () => {
    const r = spawnSync("claude", ["--version"], { shell: true, encoding: "utf8" });
    return { harness: "claude-code", installed: r.status === 0, detail: (r.stdout || r.stderr || "").trim() };
  },
  buildCommand: (combo: Combo, workdir: string) => ({
    file: "claude",
    args: ["-p", "--output-format", "stream-json", "--verbose", "--model", combo.model],
    cwd: workdir,
    // prompt 走 stdin，避免 shell 引号问题
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
              output: typeof c.content === "string" ? c.content : JSON.stringify(c.content),
              isError: !!c.is_error,
              ts: now(),
            });
          }
        }
      } else if (j.type === "system") {
        out.push({ kind: "system", text: j.subtype ?? "", ts: now() });
      } else if (j.type === "result") {
        out.push({
          kind: "done",
          usage: j.usage ? { input: j.usage.input_tokens ?? 0, output: j.usage.output_tokens ?? 0 } : undefined,
          costUsd: j.total_cost_usd,
          ts: now(),
        });
      }
      return out;
    };
    return { parse };
  },
};
