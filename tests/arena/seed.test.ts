import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { seedWorkdir } from "@/lib/arena/seed";

const src = path.join(tmpdir(), `arena-seed-src-${process.pid}`);
const dest = path.join(tmpdir(), `arena-seed-dest-${process.pid}`);

beforeEach(() => {
  for (const d of [src, dest]) rmSync(d, { recursive: true, force: true });
  // 源目录：普通文件 + 子目录 + 应被排除的顶层目录
  mkdirSync(path.join(src, "sub"), { recursive: true });
  mkdirSync(path.join(src, "node_modules", "pkg"), { recursive: true });
  mkdirSync(path.join(src, ".git"), { recursive: true });
  mkdirSync(path.join(src, ".arena"), { recursive: true });
  writeFileSync(path.join(src, "a.ts"), "const a = 1;\n");
  writeFileSync(path.join(src, "sub", "b.ts"), "const b = 2;\n");
  writeFileSync(path.join(src, "node_modules", "pkg", "x.js"), "x");
  writeFileSync(path.join(src, ".git", "HEAD"), "ref");
  writeFileSync(path.join(src, ".arena", "tmp"), "t");
});

afterEach(() => {
  for (const d of [src, dest]) rmSync(d, { recursive: true, force: true });
});

describe("seedWorkdir", () => {
  it("copies project files into the run workdir", () => {
    seedWorkdir(dest, src);
    expect(readFileSync(path.join(dest, "a.ts"), "utf8")).toBe("const a = 1;\n");
    expect(readFileSync(path.join(dest, "sub", "b.ts"), "utf8")).toBe("const b = 2;\n");
  });

  it("excludes .git / node_modules / .arena top-level dirs", () => {
    seedWorkdir(dest, src);
    expect(existsSync(path.join(dest, "node_modules"))).toBe(false);
    expect(existsSync(path.join(dest, ".git"))).toBe(false);
    expect(existsSync(path.join(dest, ".arena"))).toBe(false);
  });

  it("throws when sourceDir does not exist", () => {
    expect(() => seedWorkdir(dest, path.join(src, "nope"))).toThrow();
  });
});
