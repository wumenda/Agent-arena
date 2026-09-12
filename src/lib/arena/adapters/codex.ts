import { spawnSync } from "node:child_process";
import type { ArenaEvent } from "../types";
import type { HarnessAdapter, LineParser } from "./registry";

const now = () => Date.now();

export const codexAdapter: HarnessAdapter = {
  id: "codex",
  displayName: "Codex CLI",
  models: ["gpt-5.2-codex", "gpt-5.2", "gpt-5.1-codex", "o4-mini"],
  detect: async () => {
    const r = spawnSync("codex", ["--version"], { shell: true, encoding: "utf8" });
    return { harness: "codex", installed: r.status === 0, detail: (r.stdout || r.stderr || "").trim() };
  },
  buildCommand: (combo, workdir) => ({
    file: "codex",
    args: ["exec", "-", "--json", "-m", combo.model, "--skip-git-repo-check"],
    cwd: workdir,
    stdin: "__PROMPT__", // runner 会把该占位符替换为对局 prompt（经 stdin 传入；Task 0 实测 `-` 可用）
  }),
  createParser(): LineParser {
    let pendingUsage: { input: number; output: number } | undefined;
    const parse = (j: any): ArenaEvent[] => {
      const out: ArenaEvent[] = [];
      if (j.type === "item.completed") {
        const it = j.item;
        if (it?.type === "agent_message") out.push({ kind: "message", text: it.text ?? "", ts: now() });
        if (it?.type === "agent_reasoning" || it?.type === "reasoning") out.push({ kind: "thinking", text: it.text ?? "", ts: now() });
        if (it?.type === "command_execution") out.push({ kind: "command", command: it.command ?? "", exitCode: it.exit_code, output: it.aggregated_output, ts: now() });
        if (it?.type === "file_change") for (const ch of it.changes ?? []) out.push({ kind: "file_edit", path: ch.path, ts: now() });
      } else if (j.type === "turn.completed") {
        pendingUsage = { input: j.usage?.input_tokens ?? 0, output: j.usage?.output_tokens ?? 0 };
      } else if (j.type === "turn.failed" || j.type === "error") {
        // 实测两种形状：{"type":"turn.failed","error":{...}} 与 {"type":"error","message":...}
        out.push({ kind: "error", text: j.error?.message ?? j.message ?? JSON.stringify(j), ts: now() });
      }
      return out;
    };
    return {
      parse: (line: string): ArenaEvent[] => {
        try { return parse(JSON.parse(line)); } catch { return []; }
      },
      flush: (): ArenaEvent[] => {
        const done: ArenaEvent = { kind: "done", usage: pendingUsage, ts: now() };
        pendingUsage = undefined;
        return [done];
      },
    };
  },
};
