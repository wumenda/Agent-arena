import { describe, it, expect } from "vitest";
import { opencodeAdapter } from "@/lib/arena/adapters/opencode";

describe("opencode adapter", () => {
  it("emits message events for text chunks and done on flush", () => {
    const parser = opencodeAdapter.createParser();
    const evs = parser.parse("正在创建文件...");
    expect(evs[0].kind).toBe("message");
    expect((evs[0] as any).text).toContain("正在创建文件");
    expect(parser.flush?.()[0].kind).toBe("done");
  });

  it("parses opencode jsonl events (Task 0 实测 --format json)", () => {
    const parser = opencodeAdapter.createParser();
    const evs = [
      ...parser.parse('{"type":"text","timestamp":1,"part":{"type":"text","text":"OK"}}'),
      ...parser.parse('{"type":"step_finish","timestamp":2,"part":{"reason":"stop","tokens":{"input":32,"output":1},"cost":0}}'),
    ];
    expect(evs[0].kind).toBe("message");
    expect((evs[0] as any).text).toBe("OK");
    const done = evs.find((e) => e.kind === "done");
    expect(done).toBeDefined();
    expect((done as any).usage).toEqual({ input: 32, output: 1 });
    expect((done as any).costUsd).toBe(0);
    // done 已由 step_finish 发出，flush 不应重复
    expect(parser.flush?.()).toHaveLength(0);
  });

  it("builds run command with model and json format", () => {
    const cmd = opencodeAdapter.buildCommand({ harness: "opencode", model: "ark/glm-5.2" }, "D:/tmp/run3");
    expect(cmd.file).toBe("opencode");
    expect(cmd.args[0]).toBe("run");
    expect(cmd.args).toContain("--model");
    expect(cmd.args).toContain("--format");
    expect(cmd.args).toContain("json");
  });
});
