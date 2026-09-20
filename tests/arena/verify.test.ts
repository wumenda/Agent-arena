import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdirSync, writeFileSync, existsSync, rmSync, readFileSync, cpSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execSync } from "node:child_process";
import { verifyFix } from "@/lib/arena/verify";

// npm test 启动较慢（Windows npm shim），超时兜底 60s
const TIMEOUT = 60_000;
const base = path.join(tmpdir(), `arena-verify-${process.pid}`);

function makeProject(name: string, pkg: object | null) {
  const dir = path.join(base, name);
  mkdirSync(dir, { recursive: true });
  if (pkg) writeFileSync(path.join(dir, "package.json"), JSON.stringify(pkg));
  return dir;
}

beforeEach(() => rmSync(base, { recursive: true, force: true }));
afterEach(() => rmSync(base, { recursive: true, force: true }));

describe(
  "verifyFix",
  () => {
    it("returns passed when test script exits 0", async () => {
      const dir = makeProject("pass", { scripts: { test: 'node -e "process.exit(0)"' } });
      const r = await verifyFix(dir, { timeoutMs: TIMEOUT });
      expect(r.status).toBe("passed");
      expect(readFileSync(path.join(dir, "verify.log"), "utf8")).toContain("exit=0");
    }, TIMEOUT + 5000);

    it("returns failed when test script exits non-zero", async () => {
      const dir = makeProject("fail", { scripts: { test: 'node -e "process.exit(1)"' } });
      const r = await verifyFix(dir, { timeoutMs: TIMEOUT });
      expect(r.status).toBe("failed");
    }, TIMEOUT + 5000);

    it("returns skipped when package.json is missing", async () => {
      const dir = makeProject("nopkg", null);
      const r = await verifyFix(dir, { timeoutMs: TIMEOUT });
      expect(r.status).toBe("skipped");
      expect(existsSync(path.join(dir, "verify.log"))).toBe(true);
    }, TIMEOUT + 5000);

    it("returns skipped when test script is missing", async () => {
      const dir = makeProject("noscript", { name: "x" });
      const r = await verifyFix(dir, { timeoutMs: TIMEOUT });
      expect(r.status).toBe("skipped");
    }, TIMEOUT + 5000);

    it("restores tampered test files from git sourceDir before verifying (anti-cheat)", async () => {
      // 题库：git 仓库，test.js 输出 original 并正常退出
      const src = path.join(base, "repo");
      mkdirSync(src, { recursive: true });
      writeFileSync(path.join(src, "package.json"), JSON.stringify({ scripts: { test: "node test.js" } }));
      writeFileSync(path.join(src, "test.js"), 'console.log("original test");\n');
      execSync("git init", { cwd: src, stdio: "ignore" });
      execSync('git add -A && git -c user.name=t -c user.email=t@t@localhost commit -m init', { cwd: src, stdio: "ignore" });

      // 模拟 seed + agent 作弊：把测试改成直接失败
      const dir = path.join(base, "cheat");
      cpSync(src, dir, { recursive: true });
      writeFileSync(path.join(dir, "test.js"), "process.exit(1);\n");

      const r = await verifyFix(dir, { sourceDir: src, timeoutMs: TIMEOUT });
      expect(r.status, r.log).toBe("passed"); // 原始测试被恢复，作弊无效
      expect(r.log).toContain("已从题库恢复");
      expect(readFileSync(path.join(dir, "test.js"), "utf8")).toContain("original test");
    }, TIMEOUT + 5000);

    it("restores tests when sourceDir has no own .git but sits inside a parent git repo (内置题库场景)", async () => {
      // 内置题库嵌在本仓库内：题目目录自身无 .git，git ls-files 向上继承父仓库。
      // 父仓库还包含题目目录之外的文件（tests/arena/x.test.ts），验证恢复只限 sourceDir 范围不串味
      const parent = path.join(base, "parent-repo");
      const src = path.join(parent, "questions", "mybank", "myq");
      mkdirSync(path.join(parent, "tests", "arena"), { recursive: true });
      mkdirSync(src, { recursive: true });
      writeFileSync(path.join(parent, "package.json"), JSON.stringify({ scripts: { test: "node test.js" } }));
      writeFileSync(path.join(src, "package.json"), JSON.stringify({ scripts: { test: "node test.js" } }));
      writeFileSync(path.join(src, "test.js"), 'console.log("original test");\n');
      writeFileSync(path.join(parent, "tests", "arena", "x.test.ts"), "it('is arena test', () => {});\n");
      execSync("git init", { cwd: parent, stdio: "ignore" });
      execSync('git add -A && git -c user.name=t -c user.email=t@t@localhost commit -m init', { cwd: parent, stdio: "ignore" });

      // agent 作弊：改测试。sourceDir（题目目录）本身无 .git
      const dir = path.join(base, "cheat-nested");
      cpSync(src, dir, { recursive: true });
      writeFileSync(path.join(dir, "test.js"), "process.exit(1);\n");

      const r = await verifyFix(dir, { sourceDir: src, timeoutMs: TIMEOUT });
      expect(r.status, r.log).toBe("passed"); // 父仓库的原始测试被恢复，反作弊对内置题库生效
      expect(r.log).toContain("已从题库恢复 2 个原始测试文件");
      expect(readFileSync(path.join(dir, "test.js"), "utf8")).toContain("original test");
    }, TIMEOUT + 5000);

    it("skips restore silently when sourceDir is outside any git repo (用户题库场景)", async () => {
      // .arena/questions 下用户自放题目不在任何 git 仓库内：git ls-files 失败/空 → 跳过恢复
      const src = path.join(base, "nogit");
      mkdirSync(src, { recursive: true });
      writeFileSync(path.join(src, "package.json"), JSON.stringify({ scripts: { test: "node test.js" } }));
      writeFileSync(path.join(src, "test.js"), 'console.log("original test");\n');
      const r = await verifyFix(src, { sourceDir: src, timeoutMs: TIMEOUT });
      expect(r.status).toBe("passed"); // 测试未被 agent 改过，原样通过
      expect(r.log).not.toContain("已从题库恢复");
    }, TIMEOUT + 5000);
  },
);
