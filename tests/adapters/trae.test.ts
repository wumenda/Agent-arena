import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { traeAdapter } from "@/lib/arena/adapters/trae";

const lines = readFileSync(path.join(__dirname, "../fixtures/trae.jsonl"), "utf8")
  .split("\n").filter(Boolean);

describe("trae adapter", () => {
  it("normalizes stream-json lines to ArenaEvents", () => {
    const parser = traeAdapter.createParser();
    const events = lines.flatMap((l) => parser.parse(l));
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("system"); // init 快照
    expect(kinds).toContain("thinking"); // reasoning_content
    expect(kinds).toContain("tool_call");
    expect(kinds).toContain("file_edit"); // Write 工具调用 → file_edit
    expect(kinds).toContain("tool_result");
    expect(kinds).toContain("message");
    expect(kinds).toContain("done");
    // system/status 噪音行不产生事件
    const systemEvents = events.filter((e) => e.kind === "system");
    expect(systemEvents).toHaveLength(1);
    const done = events.find((e) => e.kind === "done")!;
    expect(done.usage?.input).toBe(360);
    expect(done.usage?.output).toBe(45);
    expect(done.usage?.cacheRead).toBe(300);
    const tr = events.find((e) => e.kind === "tool_result")!;
    expect(tr.tool).toBe("Write");
    expect(tr.output).toContain("File created successfully");
    const call = events.find((e) => e.kind === "tool_call")!;
    expect(call.tool).toBe("Write");
  });

  it("passes prompt as argv (not stdin) and overrides model via -c", () => {
    const cmd = traeAdapter.buildCommand(
      { harness: "trae", model: "Doubao-Seed-Evolving" },
      "D:/tmp/run1",
      "创建 hello.txt"
    );
    expect(cmd.file).toBe("traecli");
    expect(cmd.shell).toBe(false); // .exe 直调，Node 原生转义 argv
    expect(cmd.stdin).toBeUndefined(); // traecli 不读取 stdin
    expect(cmd.args[0]).toBe("-p");
    expect(cmd.args[1]).toBe("创建 hello.txt"); // prompt 为第一个位置参数
    expect(cmd.args).toContain("-c");
    expect(cmd.args).toContain("model.name=Doubao-Seed-Evolving");
    expect(cmd.args).toContain("-y");
    expect(cmd.cwd).toBe("D:/tmp/run1");
  });
});
