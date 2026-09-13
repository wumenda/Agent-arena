import type { ArenaEvent } from "../types";
import type { HarnessAdapter, LineParser } from "./registry";
import { parseTomlModels, readHomeFile, runVersion, uniq } from "./model-probe";

const now = () => Date.now();

export const codexAdapter: HarnessAdapter = {
  id: "codex",
  displayName: "Codex CLI",
  // 接入火山方舟 Agent Plan（Responses API，env_key=ARK_API_KEY）
  models: ["glm-5.3-flash", "glm-5.2", "doubao-seed-2.1-turbo"],
  detect: async () => {
    const r = await runVersion("codex");
    // 动态模型：~/.codex/config.toml 顶层与 profiles 的 model 键，前置本地配置；无则回退静态建议值
    const toml = readHomeFile(".codex", "config.toml");
    const parsed = toml ? parseTomlModels(toml) : [];
    const models = parsed.length ? uniq([...parsed, ...codexAdapter.models]) : undefined;
    return { harness: "codex", installed: r.ok, detail: r.detail, models };
  },
  buildCommand: (combo, workdir) => ({
    file: "codex",
    // workspace-write：允许在临时 workdir 内写文件（默认 read-only 无法完成任务）
    args: ["exec", "-", "--json", "-m", combo.model, "--skip-git-repo-check", "--sandbox", "workspace-write"],
    cwd: workdir,
    stdin: "__PROMPT__", // runner 会把该占位符替换为对局 prompt（经 stdin 传入；Task 0 实测 `-` 可用）
  }),
  createParser(): LineParser {
    let pendingUsage: { input: number; output: number; cacheRead: number } | undefined;
    const parse = (j: any): ArenaEvent[] => {
      const out: ArenaEvent[] = [];
      if (j.type === "item.completed") {
        const it = j.item;
        if (it?.type === "agent_message") out.push({ kind: "message", text: it.text ?? "", ts: now() });
        if (it?.type === "agent_reasoning" || it?.type === "reasoning") out.push({ kind: "thinking", text: it.text ?? "", ts: now() });
        if (it?.type === "command_execution") out.push({ kind: "command", command: it.command ?? "", exitCode: it.exit_code, output: it.aggregated_output, ts: now() });
        if (it?.type === "file_change") for (const ch of it.changes ?? []) out.push({ kind: "file_edit", path: ch.path, ts: now() });
      } else if (j.type === "turn.completed") {
        pendingUsage = {
          input: j.usage?.input_tokens ?? 0,
          output: j.usage?.output_tokens ?? 0,
          cacheRead: j.usage?.cached_input_tokens ?? 0,
        };
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
