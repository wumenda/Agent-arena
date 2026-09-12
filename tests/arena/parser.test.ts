import { describe, it, expect, vi } from "vitest";
import { parseNaturalLanguage } from "@/lib/arena/parser";

function okResponse(content: string) {
  return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
}

describe("parseNaturalLanguage", () => {
  it("parses valid JSON from the model into a MatchConfig", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okResponse(
      JSON.stringify({ prompt: "写一个贪吃蛇", combos: [{ harness: "claude-code", model: "sonnet" }, { harness: "codex", model: "gpt-5.2-codex" }] })
    )));
    const cfg = await parseNaturalLanguage("对比 claude code 和 codex 写贪吃蛇");
    expect(cfg?.combos).toHaveLength(2);
    expect(cfg?.prompt).toBe("写一个贪吃蛇");
    vi.unstubAllGlobals();
  });

  it("returns null on invalid model output", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okResponse("这不是 JSON")));
    expect(await parseNaturalLanguage("随便")).toBeNull();
    vi.unstubAllGlobals();
  });
});
