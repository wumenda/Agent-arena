import { describe, it, expect } from "vitest";
import { diffLines } from "@/lib/arena/diff";

describe("diffLines", () => {
  it("returns all same for identical lines", () => {
    const d = diffLines(["a", "b"], ["a", "b"]);
    expect(d.every((l) => l.type === "same")).toBe(true);
    expect(d).toHaveLength(2);
  });
  it("marks deleted and added lines", () => {
    const d = diffLines(["a", "b"], ["a", "c"]);
    expect(d).toEqual([
      { type: "same", text: "a" },
      { type: "del", text: "b" },
      { type: "add", text: "c" },
    ]);
  });
  it("handles empty inputs", () => {
    expect(diffLines([], ["x"])).toEqual([{ type: "add", text: "x" }]);
    expect(diffLines(["x"], [])).toEqual([{ type: "del", text: "x" }]);
  });
  it("keeps longest common subsequence order", () => {
    const d = diffLines(["1", "2", "3"], ["2", "3", "4"]);
    expect(d.filter((l) => l.type === "same").map((l) => l.text)).toEqual(["2", "3"]);
  });
});
