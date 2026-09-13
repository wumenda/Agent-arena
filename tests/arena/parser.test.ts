import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { parseNaturalLanguage } from "@/lib/arena/parser";

function okResponse(content: string) {
  return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
}

describe("parseNaturalLanguage", () => {
  beforeEach(() => {
    vi.stubEnv("ARK_BASE_URL", "https://example.invalid");
    vi.stubEnv("ARK_API_KEY", "test-key");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("parses valid JSON from the model into a MatchConfig", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okResponse(
      JSON.stringify({ prompt: "写一个贪吃蛇", combos: [{ harness: "claude-code", model: "sonnet" }, { harness: "codex", model: "gpt-5.2-codex" }] })
    )));
    const result = await parseNaturalLanguage("对比 claude code 和 codex 写贪吃蛇");
    if (!result.ok) throw new Error("应解析成功");
    expect(result.config.combos).toHaveLength(2);
    expect(result.config.prompt).toBe("写一个贪吃蛇");
  });

  it("returns invalid-output on invalid model output", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okResponse("这不是 JSON")));
    expect(await parseNaturalLanguage("随便")).toEqual({ ok: false, reason: "invalid-output" });
  });

  it("returns upstream-error when the API responds non-ok or throws", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 })));
    expect(await parseNaturalLanguage("随便")).toEqual({ ok: false, reason: "upstream-error" });
    vi.stubGlobal("fetch", vi.fn(async () => { throw new Error("network down"); }));
    expect(await parseNaturalLanguage("随便")).toEqual({ ok: false, reason: "upstream-error" });
  });

  it("returns no-credentials when ARK_* env missing", async () => {
    vi.stubEnv("ARK_API_KEY", "");
    expect(await parseNaturalLanguage("随便")).toEqual({ ok: false, reason: "no-credentials" });
  });
});
