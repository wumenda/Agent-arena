import { describe, it, expect } from "vitest";
import { buildMatchReport, buildMatchReportHtml } from "@/lib/arena/report";
import type { MatchRow, RunRow } from "@/lib/db/schema";

const match: MatchRow = {
  id: "m1", prompt: "写一个贪吃蛇", combos: "[]", status: "completed",
  sourceDir: null,
  timeoutMs: null,
  createdAt: new Date("2026-09-12T00:00:00Z"),
};
const run: RunRow = {
  id: "r1", matchId: "m1", harness: "claude-code", model: "glm-5.3-flash",
  status: "completed", error: null, workdir: "/tmp/x", startedAt: null, finishedAt: null,
  durationMs: 61000, tokensIn: 100, tokensOut: 20, costUsd: 0.05, verifyStatus: null,
};
const events = [
  { kind: "tool_call", tool: "Write", input: {}, ts: 1 },
  { kind: "file_edit", path: "snake.html", ts: 2 },
  { kind: "message", text: "完成", ts: 3 },
] as never;

describe("buildMatchReport", () => {
  it("renders header, metrics table and per-run sections", () => {
    const md = buildMatchReport(match, [run], { r1: events });
    expect(md).toContain("# 对局报告 m1");
    expect(md).toContain("写一个贪吃蛇");
    expect(md).toContain("claude-code×glm-5.3-flash");
    expect(md).toContain("1m1s"); // 61000ms
    expect(md).toContain("100→20");
    expect(md).toContain("$0.0500");
    expect(md).toContain("snake.html");
    expect(md).toContain("完成");
  });

  it("truncates final answer by default and keeps it with full=true", () => {
    const longEvents = [
      { kind: "message", text: "x".repeat(3000) + "END_MARK", ts: 1 },
    ] as never;
    const truncated = buildMatchReport(match, [run], { r1: longEvents });
    expect(truncated).not.toContain("END_MARK"); // 默认截 2000 字
    const full = buildMatchReport(match, [run], { r1: longEvents }, { full: true });
    expect(full).toContain("END_MARK"); // full 时不截断
  });

  it("renders self-contained HTML with escaped prompt and metrics", () => {
    const xssMatch = { ...match, prompt: "<script>alert(1)</script>" };
    const html = buildMatchReportHtml(xssMatch, [run], { r1: events });
    expect(html).toContain("<!doctype html>");
    expect(html).toContain("对局报告 m1");
    expect(html).toContain("claude-code×glm-5.3-flash");
    expect(html).toContain("$0.0500");
    expect(html).toContain("snake.html");
    expect(html).not.toContain("<script>alert(1)</script>"); // prompt 已转义
    expect(html).toContain("&lt;script&gt;");
  });

  it("HTML 报告默认截断最终回答、full=true 不截断（与 markdown 通道一致）", () => {
    const longEvents = [
      { kind: "message", text: "y".repeat(3000) + "END_MARK", ts: 1 },
    ] as never;
    const truncated = buildMatchReportHtml(match, [run], { r1: longEvents });
    expect(truncated).not.toContain("END_MARK");
    expect(truncated).toContain("前 2000 字");
    const full = buildMatchReportHtml(match, [run], { r1: longEvents }, { full: true });
    expect(full).toContain("END_MARK");
    expect(full).toContain("完整未截断");
  });
});
