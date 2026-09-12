import type { MatchRow, RunRow } from "@/lib/db/schema";
import type { ArenaEvent } from "./types";

const fmt = (ms: number | null) =>
  ms == null ? "n/a" : ms > 60000 ? `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s` : `${(ms / 1000).toFixed(1)}s`;

const fileEditPaths = (evs: ArenaEvent[]) =>
  [...new Set(evs.filter((e) => e.kind === "file_edit").map((e) => (e as { path: string }).path))];

// 对局报告（markdown）：指标汇总表 + 每个 Run 的产出文件与最终回答
export function buildMatchReport(match: MatchRow, runs: RunRow[], eventsByRun: Record<string, ArenaEvent[]>): string {
  const lines: string[] = [];
  lines.push(`# 对局报告 ${match.id}`);
  lines.push("");
  lines.push(`- **任务**：${match.prompt}`);
  lines.push(`- **时间**：${new Date(match.createdAt).toLocaleString()}`);
  lines.push(`- **状态**：${match.status}`);
  lines.push("");
  lines.push(`## 指标对比`);
  lines.push("");
  lines.push(`| 组合 | 状态 | 耗时 | tokens in→out | 成本 | 工具调用 | 产出文件 |`);
  lines.push(`|---|---|---|---|---|---|---|`);
  for (const r of runs) {
    const evs = eventsByRun[r.id] ?? [];
    const toolCalls = evs.filter((e) => e.kind === "tool_call").length;
    lines.push(
      `| ${r.harness}×${r.model} | ${r.status} | ${fmt(r.durationMs)} | ` +
      `${r.tokensIn != null ? `${r.tokensIn}→${r.tokensOut}` : "n/a"} | ` +
      `${r.costUsd != null ? `$${r.costUsd.toFixed(4)}` : "n/a"} | ${toolCalls} | ${fileEditPaths(evs).length} |`
    );
  }
  for (const r of runs) {
    lines.push("");
    lines.push(`## ${r.harness}×${r.model}`);
    const evs = eventsByRun[r.id] ?? [];
    const files = fileEditPaths(evs);
    if (files.length) lines.push(`- 产出文件：${files.join("、")}`);
    const lastMsg = [...evs].reverse().find((e) => e.kind === "message") as { text: string } | undefined;
    if (lastMsg) {
      lines.push(`- 最终回答：`);
      lines.push("");
      lines.push("```");
      lines.push(lastMsg.text.slice(0, 2000));
      lines.push("```");
    }
    if (r.error) lines.push(`- 错误：${r.error}`);
  }
  return lines.join("\n");
}
