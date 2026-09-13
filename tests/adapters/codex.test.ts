import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { codexAdapter } from "@/lib/arena/adapters/codex";

const lines = readFileSync(path.join(__dirname, "../fixtures/codex.jsonl"), "utf8")
  .split("\n").filter(Boolean);

describe("codex adapter", () => {
  it("normalizes codex jsonl to ArenaEvents with usage on turn.completed", () => {
    const parser = codexAdapter.createParser();
    const events = lines.flatMap((l) => parser.parse(l));
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("thinking");
    expect(kinds).toContain("command");
    expect(kinds).toContain("file_edit");
    expect(kinds).toContain("message");
    const done = events.find((e) => e.kind === "done");
    expect(done).toBeUndefined(); // done 在 flush 时才发出（turn.completed 才有 usage）
  });

  it("flush emits done with pending usage", () => {
    const parser = codexAdapter.createParser();
    parser.parse(lines[lines.length - 1]); // turn.completed 行
    const flushed = parser.flush?.() ?? [];
    expect(flushed[0].kind).toBe("done");
    expect((flushed[0] as any).usage.input).toBe(100);
    expect((flushed[0] as any).usage.output).toBe(60);
  });

  it("maps turn.failed and error to error events", () => {
    const parser = codexAdapter.createParser();
    const evs = parser.parse(JSON.stringify({ type: "turn.failed", error: { message: "boom" } }));
    expect(evs[0].kind).toBe("error");
    // 实测格式：{"type":"error","message":...} 无 error 字段
    const evs2 = parser.parse(JSON.stringify({ type: "error", message: "http 503" }));
    expect(evs2[0].kind).toBe("error");
    expect((evs2[0] as any).text).toBe("http 503");
  });

  it("builds exec command with model flag", () => {
    const cmd = codexAdapter.buildCommand({ harness: "codex", model: "gpt-5.2-codex" }, "D:/tmp/run2");
    expect(cmd.file).toBe("codex");
    expect(cmd.args[0]).toBe("exec");
    expect(cmd.args).toContain("--json");
    expect(cmd.args).toContain("-m");
    expect(cmd.args).toContain("--skip-git-repo-check"); // Task 0 实测：非 git 目录必需
    expect(cmd.args).toContain("--sandbox"); // E2E 实测：默认 read-only 无法写文件
    expect(cmd.args).toContain("workspace-write");
    expect(cmd.cwd).toBe("D:/tmp/run2");
  });

  it("builds continue command via exec resume --last（会话续聊）", () => {
    const cmd = codexAdapter.buildContinueCommand!({ harness: "codex", model: "gpt-5.2-codex" }, "D:/tmp/run2");
    expect(cmd.file).toBe("codex");
    expect(cmd.args[0]).toBe("exec");
    expect(cmd.args).toContain("resume");
    expect(cmd.args).toContain("--last");
    expect(cmd.stdin).toBe("__PROMPT__");
  });
});
