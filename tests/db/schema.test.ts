import { describe, it, expect } from "vitest";
import { createMatch, listMatches } from "@/lib/db/index";

describe("db", () => {
  it("creates and lists a match", () => {
    const m = createMatch({
      prompt: "write a snake game",
      combos: [{ harness: "claude-code", model: "sonnet" }],
      status: "pending",
    });
    expect(m.id).toMatch(/^[a-z0-9]+$/);
    const all = listMatches();
    expect(all.some((x) => x.id === m.id)).toBe(true);
  });
});
