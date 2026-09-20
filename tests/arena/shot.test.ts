import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtempSync, writeFileSync, existsSync, utimesSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { findChrome, hashKey, cleanupShots } from "@/lib/arena/shot";

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

describe("cleanupShots（截图缓存清理）", () => {
  let dir: string;
  beforeEach(() => {
    dir = mkdtempSync(path.join(os.tmpdir(), "arena-shots-"));
  });
  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("keepDays<=0 不清理", () => {
    writeFileSync(path.join(dir, "m1-abc.png"), "x");
    expect(cleanupShots(0, dir)).toBe(0);
    expect(existsSync(path.join(dir, "m1-abc.png"))).toBe(true);
  });

  it("清理超期 PNG、保留未超期与非 PNG", () => {
    const old = path.join(dir, "m1-aaa.png");
    const fresh = path.join(dir, "m2-bbb.png");
    const notPng = path.join(dir, "m3.txt");
    for (const f of [old, fresh, notPng]) writeFileSync(f, "x");
    const oldDate = new Date(Date.now() - 10 * 86400000);
    utimesSync(old, oldDate, oldDate); // 老文件 mtime 拨回 10 天前
    expect(cleanupShots(7, dir)).toBe(1);
    expect(existsSync(old)).toBe(false);
    expect(existsSync(fresh)).toBe(true);
    expect(existsSync(notPng)).toBe(true);
  });
});
