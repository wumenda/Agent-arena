import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, writeFileSync, mkdirSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { safeResolveFile, listRunFiles, readRunFile } from "@/lib/arena/files";

let dir: string;
beforeEach(() => { dir = mkdtempSync(path.join(os.tmpdir(), "arena-files-")); });

describe("safeResolveFile", () => {
  it("resolves a relative path inside workdir", () => {
    expect(safeResolveFile(dir, "hello.txt")).toBe(path.resolve(dir, "hello.txt"));
  });
  it("resolves nested paths", () => {
    expect(safeResolveFile(dir, "src/main.ts")).toBe(path.resolve(dir, "src/main.ts"));
  });
  it("rejects path traversal", () => {
    expect(safeResolveFile(dir, "../secret.txt")).toBeNull();
    expect(safeResolveFile(dir, "..\\..\\secret.txt")).toBeNull();
  });
  it("rejects absolute paths outside workdir", () => {
    expect(safeResolveFile(dir, "C:/Windows/system32/config")).toBeNull();
  });
});

describe("listRunFiles", () => {
  it("lists files recursively with / separators, excluding trajectory.jsonl", () => {
    writeFileSync(path.join(dir, "hello.txt"), "hi");
    mkdirSync(path.join(dir, "src"));
    writeFileSync(path.join(dir, "src", "main.ts"), "x");
    writeFileSync(path.join(dir, "trajectory.jsonl"), "{}");
    const files = listRunFiles(dir);
    expect(files.map((f) => f.path)).toEqual(["hello.txt", "src/main.ts"]);
    expect(files[0].size).toBe(2);
  });
});

describe("readRunFile", () => {
  it("reads content with size", () => {
    writeFileSync(path.join(dir, "hello.txt"), "hi");
    expect(readRunFile(dir, "hello.txt")).toEqual({ content: "hi", truncated: false, size: 2 });
  });
  it("returns null on traversal attempt", () => {
    expect(readRunFile(dir, "../x.txt")).toBeNull();
  });
});
