import { describe, it, expect } from "vitest";
import { buildMatchReport } from "@/lib/arena/report";
import type { MatchRow, RunRow } from "@/lib/db/schema";

const match: MatchRow = {
  id: "m1", prompt: "写一个贪吃蛇", combos: "[]", status: "completed",
  createdAt: new Date("2026-09-12T00:00:00Z"),
};
const run: RunRow = {
  id: "r1", matchId: "m1", harness: "claude-code", model: "glm-5.3-flash",
  status: "completed", error: null, workdir: "/tmp/x", startedAt: null, finishedAt: null,
  durationMs: 61000, tokensIn: 100, tokensOut: 20, costUsd: 0.05,
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
});
