import type { MatchRow, RunRow } from "@/lib/db/schema";
import type { ArenaEvent } from "./types";

const fmt = (ms: number | null) =>
  ms == null ? "n/a" : ms > 60000 ? `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s` : `${(ms / 1000).toFixed(1)}s`;

const fileEditPaths = (evs: ArenaEvent[]) =>
  [...new Set(evs.filter((e) => e.kind === "file_edit").map((e) => (e as { path: string }).path))];

// 对局报告（markdown）：指标汇总表 + 每个 Run 的产出文件与最终回答
// full=true 时最终回答不截断（默认截 2000 字，防止报告过大）
export function buildMatchReport(
  match: MatchRow,
  runs: RunRow[],
  eventsByRun: Record<string, ArenaEvent[]>,
  opts?: { full?: boolean }
): string {
  const full = opts?.full ?? false;
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
      lines.push(full ? lastMsg.text : lastMsg.text.slice(0, 2000));
      lines.push("```");
    }
    if (r.error) lines.push(`- 错误：${r.error}`);
  }
  return lines.join("\n");
}

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

// 对局报告（HTML 单文件）：同一数据源渲染为带内联样式的自包含页面，可直接在浏览器打开或分享。
// full=true 时最终回答不截断（默认截 2000 字，防止报告过大；与 markdown 通道行为一致）
export function buildMatchReportHtml(
  match: MatchRow,
  runs: RunRow[],
  eventsByRun: Record<string, ArenaEvent[]>,
  opts?: { full?: boolean },
): string {
  const full = opts?.full ?? false;
  const statusClass: Record<string, string> = {
    completed: "color:#34d399",
    running: "color:#38bdf8",
    failed: "color:#f87171",
    timeout: "color:#fbbf24",
    pending: "color:#94a3b8",
  };
  const headCells = ["组合", "状态", "耗时", "tokens in→out", "成本", "工具调用", "产出文件", "验证"];
  const rows = runs.map((r) => {
    const evs = eventsByRun[r.id] ?? [];
    const toolCalls = evs.filter((e) => e.kind === "tool_call").length;
    const files = fileEditPaths(evs);
    const cells = [
      `${esc(r.harness)}×${esc(r.model)}`,
      `<span style="${statusClass[r.status] ?? "color:#94a3b8"}">${esc(r.status)}</span>`,
      esc(fmt(r.durationMs)),
      r.tokensIn != null ? `${r.tokensIn}→${r.tokensOut}` : "n/a",
      r.costUsd != null ? `$${r.costUsd.toFixed(4)}` : "n/a",
      String(toolCalls),
      files.length ? files.map(esc).join("<br/>") : "-",
      esc(r.verifyStatus ?? "-"),
    ];
    return `<tr>${cells.map((c) => `<td style="padding:8px 12px;border-bottom:1px solid #1e293b;vertical-align:top">${c}</td>`).join("")}</tr>`;
  });

  const sections = runs.map((r) => {
    const evs = eventsByRun[r.id] ?? [];
    const files = fileEditPaths(evs);
    const lastMsg = [...evs].reverse().find((e) => e.kind === "message") as { text: string } | undefined;
    const msgCount = evs.filter((e) => e.kind === "message").length;
    const thinkCount = evs.filter((e) => e.kind === "thinking").length;
    return `<section style="margin:24px 0;padding:20px;background:#0f172a;border:1px solid #1e293b;border-radius:12px">
  <h2 style="margin:0 0 8px;font-size:16px;color:#e2e8f0">${esc(r.harness)}×${esc(r.model)}</h2>
  <p style="margin:0 0 12px;font-size:12px;color:#94a3b8">
    状态 <span style="${statusClass[r.status] ?? ""}">${esc(r.status)}</span>
    · 耗时 ${esc(fmt(r.durationMs))}
    · ${msgCount} 条回答 · ${thinkCount} 次思考
    ${r.verifyStatus ? ` · 验证 ${esc(r.verifyStatus)}` : ""}
  </p>
  ${files.length ? `<p style="margin:0 0 12px;font-size:13px;color:#94a3b8">产出文件：${files.map((f) => `<code style="color:#7dd3fc">${esc(f)}</code>`).join("、")}</p>` : ""}
  ${lastMsg ? `<div style="font-size:11px;color:#64748b;margin-bottom:4px">最终回答${full ? "" : "（前 2000 字）"}</div><pre style="margin:0;padding:12px;background:#020617;border-radius:8px;font-size:12px;line-height:1.6;color:#cbd5e1;white-space:pre-wrap;word-break:break-word;max-height:480px;overflow:auto">${esc(full ? lastMsg.text : lastMsg.text.slice(0, 2000))}</pre>` : ""}
  ${r.error ? `<p style="margin:12px 0 0;font-size:12px;color:#f87171">错误：${esc(r.error)}</p>` : ""}
</section>`;
  });

  return `<!doctype html>
<html lang="zh">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<title>对局报告 ${esc(match.id)}</title>
</head>
<body style="margin:0;background:#020617;color:#e2e8f0;font-family:ui-sans-serif,system-ui,'PingFang SC','Microsoft YaHei',sans-serif">
<div style="max-width:960px;margin:0 auto;padding:32px 20px">
  <h1 style="margin:0 0 12px;font-size:22px">对局报告 <span style="font-family:ui-monospace,monospace;font-size:16px;color:#94a3b8">${esc(match.id)}</span></h1>
  <p style="margin:0 0 20px;font-size:13px;color:#94a3b8;line-height:1.8">
    <strong style="color:#e2e8f0">任务</strong>：${esc(match.prompt)}<br/>
    <strong style="color:#e2e8f0">时间</strong>：${esc(new Date(match.createdAt).toLocaleString())}
    · <strong style="color:#e2e8f0">状态</strong>：${esc(match.status)}
  </p>
  <h2 style="font-size:15px;color:#e2e8f0">指标对比</h2>
  <div style="overflow-x:auto;margin:12px 0 8px">
    <table style="border-collapse:collapse;width:100%;font-size:12px;text-align:left">
      <thead><tr>${headCells.map((h) => `<th style="padding:8px 12px;border-bottom:1px solid #334155;color:#94a3b8;font-weight:500">${h}</th>`).join("")}</tr></thead>
      <tbody>${rows.join("")}</tbody>
    </table>
  </div>
  ${sections.join("\n")}
  <p style="margin:24px 0 0;font-size:11px;color:#475569">由 Agent 竞技场生成 · 最终回答${full ? "完整未截断" : "默认截断（报告可加 full=1 参数导出完整版）"}</p>
</div>
</body>
</html>`;
}
