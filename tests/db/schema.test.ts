import { describe, it, expect } from "vitest";
import { sql } from "drizzle-orm";
import { createMatch, listMatches, getMatchCombos, db } from "@/lib/db/index";

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

  it("persists per-match timeoutMs (null by default, value when set)", () => {
    const m1 = createMatch({ prompt: "p", combos: [{ harness: "codex", model: "m" }] });
    expect(m1.timeoutMs).toBeNull();
    const m2 = createMatch({ prompt: "p", combos: [{ harness: "codex", model: "m" }], timeoutMs: 25 * 60_000 });
    expect(m2.timeoutMs).toBe(25 * 60_000);
    const again = listMatches().find((x) => x.id === m2.id)!;
    expect(again.timeoutMs).toBe(25 * 60_000);
  });

  it("getMatchCombos 宽容解析：损坏 JSON/形状不符返回空数组不抛错", () => {
    const bad = createMatch({ prompt: "p", combos: [{ harness: "codex", model: "m" }] });
    // 用 drizzle 底层执行 SQL 修改 combos，模拟历史坏数据
    const setCombos = (s: string) =>
      db.run(sql`UPDATE matches SET combos = ${s} WHERE id = ${bad.id}`);

    expect(getMatchCombos("no-such-id")).toEqual([]); // 对局不存在
    setCombos("{broken json"); // 损坏 JSON
    expect(getMatchCombos(bad.id)).toEqual([]); // 不抛错，宽容为空
    setCombos('{"a":1}'); // 合法但非数组
    expect(getMatchCombos(bad.id)).toEqual([]);
    setCombos('[{"harness":"codex"}]'); // 缺 model 字段 → 过滤
    expect(getMatchCombos(bad.id)).toEqual([]);
    setCombos('[{"harness":"codex","model":"m"}]'); // 正常恢复
    expect(getMatchCombos(bad.id)).toEqual([{ harness: "codex", model: "m" }]);
  });
});
