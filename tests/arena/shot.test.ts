import { describe, it, expect } from "vitest";
import { findChrome, hashKey } from "@/lib/arena/shot";

describe("shot helpers", () => {
  it("hashKey is stable and differs on input", () => {
    expect(hashKey("a", "b")).toBe(hashKey("a", "b"));
    expect(hashKey("a", "b")).not.toBe(hashKey("a", "c"));
  });
  it("findChrome returns null or a plausible path", () => {
    const p = findChrome();
    if (p) expect(/chrome|msedge/i.test(p)).toBe(true);
  });
});
