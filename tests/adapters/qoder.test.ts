import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { qoderAdapter } from "@/lib/arena/adapters/qoder";

// 采样时 Qoder 账户额度耗尽，fixture 仅含实测到的事件（init / synthetic assistant / error result）。
// tool_use / tool_result 解析路径与 CodeBuddy 同构（见 codebuddy.jsonl 测试），额度恢复后应跑真实对局复核。
const lines = readFileSync(path.join(__dirname, "../fixtures/qoder.jsonl"), "utf8")
  .split("\n").filter(Boolean);

describe("qoder adapter", () => {
  it("normalizes stream-json lines to ArenaEvents", () => {
    const parser = qoderAdapter.createParser();
    const events = lines.flatMap((l) => parser.parse(l));
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("system"); // 仅 init；artifacts_update/hook_* 噪音不入轨迹
    expect(systemCount(events)).toBe(1);
    expect(kinds).toContain("message");
    expect(kinds).toContain("error"); // is_error result → error 事件
    expect(kinds).toContain("done");
    const done = events.find((e) => e.kind === "done")!;
    expect(done.usage?.input).toBe(0);
    const err = events.find((e) => e.kind === "error")!;
    expect(err.text).toContain("credit usage limit");
  });

  it("passes prompt as argv and selects model via -m", () => {
    const cmd = qoderAdapter.buildCommand(
      { harness: "qoder", model: "Qwen3.8-Max" },
      "D:/tmp/run3",
      "创建 hello.txt"
    );
    expect(cmd.file).toBe("qodercli");
    expect(cmd.shell).toBe(false); // .exe 直调，Node 原生转义 argv
    expect(cmd.args[0]).toBe("-p");
    expect(cmd.args[1]).toBe("创建 hello.txt");
    expect(cmd.args).toContain("-o");
    expect(cmd.args).toContain("stream-json");
    expect(cmd.args).toContain("--dangerously-skip-permissions");
    expect(cmd.args).toContain("-m");
    expect(cmd.args).toContain("Qwen3.8-Max");
    expect(cmd.cwd).toBe("D:/tmp/run3");
  });
});

function systemCount(events: { kind: string }[]): number {
  return events.filter((e) => e.kind === "system").length;
}
