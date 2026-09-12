import { describe, it, expect } from "vitest";
import { ComboSchema } from "@/lib/arena/types";

describe("ComboSchema", () => {
  it("accepts a known harness", () => {
    expect(() => ComboSchema.parse({ harness: "claude-code", model: "sonnet" })).not.toThrow();
  });
  it("rejects unknown harness", () => {
    expect(() => ComboSchema.parse({ harness: "trae-ide", model: "x" })).toThrow();
  });
});
