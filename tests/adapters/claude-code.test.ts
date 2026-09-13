import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { claudeCodeAdapter } from "@/lib/arena/adapters/claude-code";

const lines = readFileSync(path.join(__dirname, "../fixtures/claude-code.jsonl"), "utf8")
  .split("\n").filter(Boolean);

describe("claude-code adapter", () => {
  it("normalizes stream-json lines to ArenaEvents", () => {
    const parser = claudeCodeAdapter.createParser();
    const events = lines.flatMap((l) => parser.parse(l));
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("thinking");
    expect(kinds).toContain("file_edit"); // Write 工具调用 → file_edit
    expect(kinds).toContain("tool_result");
    expect(kinds).toContain("message");
    expect(kinds).toContain("done");
    const tr = events.find((e) => e.kind === "tool_result")!;
    expect(tr.tool).toBe("Write"); // 经 tool_use_id 回填工具名
    const done = events.find((e) => e.kind === "done")!;
    expect(done.usage?.input).toBe(120);
    expect(done.costUsd).toBeCloseTo(0.0123);
  });

  it("builds headless command with model and workdir", () => {
    const cmd = claudeCodeAdapter.buildCommand(
      { harness: "claude-code", model: "sonnet" },
      "D:/tmp/run1"
    );
    expect(cmd.file).toBe("claude");
    expect(cmd.args).toContain("--output-format");
    expect(cmd.args).toContain("stream-json");
    expect(cmd.args).toContain("--dangerously-skip-permissions"); // 无头自动化必需
    expect(cmd.args).toContain("--model");
    expect(cmd.args).toContain("sonnet");
    expect(cmd.cwd).toBe("D:/tmp/run1");
  });

  it("builds continue command with --continue（会话续聊，prompt 走 stdin）", () => {
    const cmd = claudeCodeAdapter.buildContinueCommand!({ harness: "claude-code", model: "sonnet" }, "D:/tmp/run1");
    expect(cmd.file).toBe("claude");
    expect(cmd.args).toContain("--continue");
    expect(cmd.stdin).toBe("__PROMPT__"); // prompt 统一走 __PROMPT__ 占位符，runner 替换为真实任务
  });
});
