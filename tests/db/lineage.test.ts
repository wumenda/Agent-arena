process.env.ARENA_DB = ":memory:";
import { describe, it, expect } from "vitest";
import { createMatch, getLineage } from "@/lib/db/index";

describe("getLineage", () => {
  it("walks parent chain oldest-first including self", () => {
    const m1 = createMatch({ prompt: "p", combos: [{ harness: "opencode", model: "m" }] });
    const m2 = createMatch({ prompt: "p", combos: [{ harness: "opencode", model: "m" }], parentMatchId: m1.id });
    const m3 = createMatch({ prompt: "p", combos: [{ harness: "opencode", model: "m" }], parentMatchId: m2.id });
    const chain = getLineage(m3.id);
    expect(chain.map((m) => m.id)).toEqual([m1.id, m2.id, m3.id]);
  });
  it("returns single match without parent", () => {
    const m = createMatch({ prompt: "p", combos: [{ harness: "opencode", model: "m" }] });
    expect(getLineage(m.id)).toHaveLength(1);
  });
});
