import { describe, it, expect } from "vitest";
import { adapters } from "@/lib/arena/adapters/registry";
import { CONTINUABLE_HARNESSES } from "@/lib/arena/adapters/meta";
import { HARNESS_IDS } from "@/lib/arena/types";

// 能力一致性守卫：白名单与「实现了 buildContinueCommand 的 adapter」必须同步，防漂移
describe("registry continue capability", () => {
  it("实现了 buildContinueCommand 的 harness 与 CONTINUABLE_HARNESSES 完全一致", () => {
    const continuable = Object.values(adapters)
      .filter((a) => typeof a.buildContinueCommand === "function")
      .map((a) => a.id)
      .sort();
    expect(continuable).toEqual([...CONTINUABLE_HARNESSES].sort());
  });

  it("所有 HARNESS_IDS 都已注册 adapter", () => {
    for (const id of HARNESS_IDS) expect(adapters[id]).toBeDefined();
  });
});
