process.env.ARENA_DB = ":memory:";
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { listBanks, previewHintEnabled } from "@/lib/arena/questions";

// 指向临时题库根（questions 模块用 process.cwd() 定位，测试里 ch到仓库外避免真实题库干扰）
const base = path.join(tmpdir(), `arena-questions-${process.pid}`);

beforeEach(() => {
  rmSync(base, { recursive: true, force: true });
  mkdirSync(path.join(base, "banks"), { recursive: true });
  process.chdir(path.join(base, "banks"));
  mkdirSync(path.join(base, "banks", ".arena", "questions", "demo"), { recursive: true });
});
afterEach(() => {
  process.chdir(path.join(base, ".."));
  rmSync(base, { recursive: true, force: true });
});

function makeBank(bank: string, meta: object | null) {
  const dir = path.join(base, "banks", ".arena", "questions", bank);
  mkdirSync(dir, { recursive: true });
  if (meta) writeFileSync(path.join(dir, "bank.json"), JSON.stringify(meta));
  mkdirSync(path.join(dir, "q1"), { recursive: true });
  return path.join(dir, "q1"); // 题目目录（previewHintEnabled 的入参形态 = sourceDir）
}

describe("题库扫描与 previewHint 开关", () => {
  it("bank.json 缺省时 previewHint 默认启用", () => {
    const qDir = makeBank("default-bank", null);
    expect(listBanks().find((b) => b.id === "default-bank")).toBeTruthy();
    expect(previewHintEnabled(qDir)).toBe(true);
  });

  it("bank.json 声明 previewHint: false 时关闭（算法/bug 修复题库的计量噪声开关）", () => {
    const qDir = makeBank("algo-bank", { name: "X", previewHint: false });
    expect(previewHintEnabled(qDir)).toBe(false);
  });

  it("题目目录不存在（手输 prompt 无选题）时始终启用", () => {
    expect(previewHintEnabled(null)).toBe(true);
    expect(previewHintEnabled(undefined)).toBe(true);
  });

  it("bank.json 损坏时按默认启用处理（宽松元信息读取语义）", () => {
    const qDir = makeBank("broken-bank", null);
    writeFileSync(path.join(path.dirname(qDir), "bank.json"), "{not json");
    expect(previewHintEnabled(qDir)).toBe(true);
  });
});
