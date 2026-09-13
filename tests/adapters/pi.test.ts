import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { piAdapter } from "@/lib/arena/adapters/pi";
import { parsePiModels } from "@/lib/arena/adapters/pi";

const lines = readFileSync(path.join(__dirname, "../fixtures/pi.jsonl"), "utf8")
  .split("\n").filter(Boolean);

describe("pi adapter", () => {
  it("normalizes --mode json lines to ArenaEvents", () => {
    const parser = piAdapter.createParser();
    const events = lines.flatMap((l) => parser.parse(l));
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("system"); // session 首行
    expect(kinds).toContain("thinking"); // message_end 的 thinking 块
    expect(kinds).toContain("message"); // message_end 的 text 块
    expect(kinds).toContain("tool_call");
    expect(kinds).toContain("file_edit"); // write 工具 → file_edit
    expect(kinds).toContain("tool_result");
    expect(kinds).toContain("done");
    // agent_start/turn_start/agent_settled 运行期噪音不产生事件
    expect(events.filter((e) => e.kind === "system")).toHaveLength(1);
    // message_update 只更新 usage，不产生消息事件
    expect(events.filter((e) => e.kind === "message")).toHaveLength(1);
    const done = events.find((e) => e.kind === "done")!;
    expect(done.usage?.input).toBe(147);
    expect(done.usage?.output).toBe(85);
    expect(done.usage?.cacheRead).toBe(10368);
    expect(done.costUsd).toBe(0); // GLM Coding Plan 端点不计费
    const call = events.find((e) => e.kind === "tool_call")!;
    expect(call.tool).toBe("write");
    const fe = events.find((e) => e.kind === "file_edit")!;
    expect(fe.path).toBe("hello.txt");
    const tr = events.find((e) => e.kind === "tool_result")!;
    expect(tr.tool).toBe("write");
    expect(tr.output).toContain("Successfully wrote to hello.txt");
    expect(tr.isError).toBe(false);
  });

  it("passes prompt via stdin and selects model with --model", () => {
    const cmd = piAdapter.buildCommand(
      { harness: "pi", model: "ark/glm-5.3-flash" },
      "D:/tmp/run1",
      "创建 hello.txt"
    );
    expect(cmd.file).toBe("pi");
    expect(cmd.stdin).toBe("创建 hello.txt"); // prompt 走 stdin，规避 cmd 转义问题
    expect(cmd.args).toContain("--mode");
    expect(cmd.args).toContain("json");
    expect(cmd.args).toContain("--no-session");
    expect(cmd.args).toContain("--model");
    expect(cmd.args).toContain("ark/glm-5.3-flash");
    expect(cmd.cwd).toBe("D:/tmp/run1");
  });

  it("parses --list-models table into provider/model ids", () => {
    const table = [
      "provider  model          context  max-out  thinking  images",
      "ark       glm-5.3-flash  128K     16.4K    no        no",
      "ark       glm-5.2        128K     32.8K    yes       no",
    ].join("\n");
    expect(parsePiModels(table)).toEqual(["ark/glm-5.3-flash", "ark/glm-5.2"]);
  });
});
