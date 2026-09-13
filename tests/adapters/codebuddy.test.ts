import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { codebuddyAdapter } from "@/lib/arena/adapters/codebuddy";

const lines = readFileSync(path.join(__dirname, "../fixtures/codebuddy.jsonl"), "utf8")
  .split("\n").filter(Boolean);

describe("codebuddy adapter", () => {
  it("normalizes stream-json lines to ArenaEvents", () => {
    const parser = codebuddyAdapter.createParser();
    const events = lines.flatMap((l) => parser.parse(l));
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("thinking");
    expect(kinds).toContain("tool_call");
    expect(kinds).toContain("file_edit"); // Write 工具调用 → file_edit
    expect(kinds).toContain("tool_result");
    expect(kinds).toContain("message");
    expect(kinds).toContain("system");
    expect(kinds).toContain("done");
    const done = events.find((e) => e.kind === "done")!;
    expect(done.usage?.input).toBe(74892);
    expect(done.usage?.output).toBe(101);
    expect(done.usage?.cacheRead).toBe(68800);
    const tr = events.find((e) => e.kind === "tool_result")!;
    expect(tr.output).toContain("Successfully created"); // content blocks 数组抽取文本
    expect(tr.tool).toBe("Write"); // 经 tool_use_id 回填工具名
    const fe = events.find((e) => e.kind === "file_edit")!;
    expect(fe.path).toContain("hello.txt");
  });

  it("builds headless command with -y, model and stdin prompt", () => {
    const cmd = codebuddyAdapter.buildCommand(
      { harness: "codebuddy", model: "glm-5.3" },
      "D:/tmp/run2"
    );
    expect(cmd.file).toBe("codebuddy");
    expect(cmd.args).toContain("-p");
    expect(cmd.args).toContain("--output-format");
    expect(cmd.args).toContain("stream-json");
    expect(cmd.args).toContain("-y"); // 非交互模式必需
    expect(cmd.args).toContain("--model");
    expect(cmd.args).toContain("glm-5.3");
    expect(cmd.stdin).toBe("__PROMPT__"); // runner 会替换为对局 prompt
    expect(cmd.cwd).toBe("D:/tmp/run2");
  });
});
