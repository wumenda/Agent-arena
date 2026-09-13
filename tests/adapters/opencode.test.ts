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
    // step_finish 不再直接发 done；flush 时统一发出
    expect(evs.find((e) => e.kind === "done")).toBeUndefined();
    const done = parser.flush?.()[0];
    expect(done?.kind).toBe("done");
    expect((done as any).usage).toEqual({ input: 32, output: 1, cacheRead: 0 });
  });

  it("accumulates usage across step_finish (收尾空转 step 不得覆盖累计值)", () => {
    const parser = opencodeAdapter.createParser();
    parser.parse('{"type":"step_finish","part":{"tokens":{"input":100,"output":50}}}');
    parser.parse('{"type":"step_finish","part":{"tokens":{"input":35,"output":0,"cache":{"read":10}}}}');
    const done = parser.flush?.()[0];
    expect((done as any).usage).toEqual({ input: 135, output: 50, cacheRead: 10 });
  });

  it("maps tool_use envelopes to tool_call and file_edit (Task 0/E2E 实测)", () => {
    const parser = opencodeAdapter.createParser();
    const evs = parser.parse(JSON.stringify({
      type: "tool_use",
      part: { type: "tool", tool: "write", callID: "c1", state: { status: "completed", input: { filePath: "D:/run/x.html", content: "hi" }, output: "ok" } },
    }));
    expect(evs.map((e) => e.kind)).toEqual(["tool_call", "file_edit"]);
    expect((evs[1] as any).path).toBe("D:/run/x.html");
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
