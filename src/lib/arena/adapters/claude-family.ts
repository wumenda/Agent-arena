import type { ArenaEvent } from "../types";
import type { LineParser } from "./registry";

// tool_result 的 content 可能是字符串或 content blocks 数组，统一抽取文本
export function blocksText(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    const t = content.map((b: any) => (typeof b?.text === "string" ? b.text : "")).filter(Boolean).join("\n");
    if (t) return t;
  }
  return JSON.stringify(content ?? "");
}

export type ClaudeFamilyOptions = {
  /**
   * system 信封行自定义渲染：返回 null 走默认（每行产出一条 {text: j.subtype}）；
   * 返回数组则逐项产出 system 事件（空数组 = 丢弃该行，qoder 用它过滤 hook_* 噪音）
   */
  systemEvents?: (j: any) => { text: string }[] | null;
  /** result.is_error 时产出 error 事件，返回错误文本（不传则不产出 error 事件） */
  errorText?: (result: any, lastText: string) => string;
};

/**
 * Claude stream-json 同构族共享 parser 工厂（claude-code / codebuddy / qoder）。
 * 事件信封：system/init → assistant(content blocks) → user/tool_result → result；
 * 三家仅 system 行渲染与 error 文本兜底不同，经 options 注入，其余逻辑收编于此。
 */
export function createClaudeFamilyParser(opts: ClaudeFamilyOptions = {}): LineParser {
  const now = () => Date.now();
  // tool_use id → 工具名映射：后续 tool_result 经 tool_use_id 回填工具名，查不到时兜底最近一次工具名
  const toolNames = new Map<string, string>();
  let lastTool = "";
  // result 行可能不带 errors/result 字段（错误详情在 assistant 文本里），兜底取最后一条 assistant 文本
  let lastText = "";
  const parse = (line: string): ArenaEvent[] => {
    let j: any;
    try { j = JSON.parse(line); } catch { return []; }
    const out: ArenaEvent[] = [];
    if (j.type === "system") {
      const events = opts.systemEvents ? opts.systemEvents(j) : null;
      if (events === null) out.push({ kind: "system", text: j.subtype ?? "", ts: now() });
      else for (const e of events) out.push({ kind: "system", text: e.text, ts: now() });
    } else if (j.type === "assistant" && j.message?.content) {
      for (const c of j.message.content) {
        if (c.type === "text") {
          if (c.text) lastText = c.text;
          out.push({ kind: "message", text: c.text ?? "", ts: now() });
        }
        if (c.type === "thinking") out.push({ kind: "thinking", text: c.thinking ?? "", ts: now() });
        if (c.type === "tool_use") {
          if (c.id) toolNames.set(c.id, c.name);
          lastTool = c.name;
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
            tool: (c.tool_use_id && toolNames.get(c.tool_use_id)) || lastTool,
            output: blocksText(c.content),
            isError: !!c.is_error,
            ts: now(),
          });
        }
      }
    } else if (j.type === "result") {
      if (j.is_error && opts.errorText) {
        out.push({ kind: "error", text: opts.errorText(j, lastText), ts: now() });
      }
      out.push({
        kind: "done",
        usage: j.usage ? {
          input: j.usage.input_tokens ?? 0,
          output: j.usage.output_tokens ?? 0,
          cacheRead: j.usage.cache_read_input_tokens ?? 0,
        } : undefined,
        costUsd: j.total_cost_usd, // 仅作参考；落库前由 runner 按 pricing.ts 统一重算
        ts: now(),
      });
    }
    return out;
  };
  return { parse };
}
