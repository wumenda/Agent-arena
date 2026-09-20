import { spawn } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { killTree } from "./proc";
export type VerifyStatus = "passed" | "failed" | "skipped";
export type VerifyResult = { status: VerifyStatus; log: string };

// 测试文件识别：*.test.* / *.spec.*、名为 test.*/spec.* 的文件、__tests__|tests|test|spec 目录
// （题库以 JS 生态约定为准）
const TEST_FILE_RE = /(^|[\\/])(__tests__|tests?|spec)[\\/]|(^|[\\/])(test|spec)\.[cm]?[jt]sx?$|\.(test|spec)\.[cm]?[jt]sx?$/i;

// 严格验证前置：从题库 git 仓库枚举原始测试文件（含 package.json），复制回运行目录覆盖 agent 的
// 改动——防止 agent 修改测试或 test 脚本"自证通过"。只覆盖测试相关文件，不碰 agent 的修复代码。
// 门条件：不要求 sourceDir 自带 .git——内置题库嵌在本仓库内，git ls-files 以 cwd 为作用域
// 会向上继承父仓库且只返回该题目目录的文件；非 git 目录 ls-files 返回空，走下方跳过路径
async function restoreOriginalTests(sourceDir: string, workdir: string): Promise<string> {
  const files = await new Promise<string[]>((resolve) => {
    const child = spawn("git", ["ls-files"], { cwd: sourceDir, shell: false });
    let out = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => (out += d));
    child.on("error", () => resolve([]));
    child.on("close", () => resolve(out.split("\n").map((l) => l.trim()).filter(Boolean)));
  });
  if (!files.length) return "[verify] git ls-files 为空，跳过原始测试恢复";
  const targets = files.filter((f) => TEST_FILE_RE.test(f) || f === "package.json");
  if (!targets.length) return "[verify] 题库未发现测试文件（*.test.* / *.spec.* / __tests__），跳过恢复";
  for (const rel of targets) {
    const from = path.join(sourceDir, rel);
    if (!existsSync(from)) continue; // git 跟踪但工作区已删除的文件
    const to = path.join(workdir, rel);
    mkdirSync(path.dirname(to), { recursive: true });
    copyFileSync(from, to);
  }
  return `[verify] 已从题库恢复 ${targets.length} 个原始测试文件（含 package.json），覆盖 agent 的改动`;
}

// 修复验证：在运行工作目录里执行题目自带的测试套件（package.json 的 test 脚本 → npm test），
// 判定"bug 是否真修好"。无测试套件则 skipped，结果与完整日志写入 verify.log。
export async function verifyFix(
  workdir: string,
  opts: { sourceDir?: string | null; timeoutMs?: number } = {},
): Promise<VerifyResult> {
  const timeoutMs = opts.timeoutMs ?? 5 * 60 * 1000;
  const logPath = path.join(workdir, "verify.log");
  const lines: string[] = [];

  if (opts.sourceDir) {
    lines.push(await restoreOriginalTests(opts.sourceDir, workdir));
  }

  const pkgPath = path.join(workdir, "package.json");
  let testScript: string | undefined;
  if (existsSync(pkgPath)) {
    try { testScript = JSON.parse(readFileSync(pkgPath, "utf8"))?.scripts?.test; } catch {}
  }
  if (!testScript) {
    lines.push("[verify] skipped: 未找到 package.json 的 test 脚本");
    const log = lines.join("\n") + "\n";
    writeFileSync(logPath, log);
    return { status: "skipped", log };
  }

  const started = Date.now();
  const chunks: string[] = [];
  let timedOut = false;
  const code = await new Promise<number>((resolve) => {
    const child = spawn("npm", ["test"], { cwd: workdir, shell: true, env: { ...process.env } });
    const timer = setTimeout(() => {
      timedOut = true;
      if (child.pid) killTree(child.pid);
    }, timeoutMs);
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (d: string) => chunks.push(d));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (d: string) => chunks.push(d));
    child.on("error", (err) => { clearTimeout(timer); chunks.push(String(err)); resolve(-1); });
    child.on("close", (c) => { clearTimeout(timer); resolve(c ?? -1); });
  });
  lines.push(...chunks.join("").split("\n"));
  lines.push(timedOut
    ? `[verify] timeout: 测试超过 ${Math.round(timeoutMs / 1000)}s 被终止, exit=${code}`
    : `[verify] exit=${code} durationMs=${Date.now() - started}`);
  const log = lines.join("\n") + "\n";
  writeFileSync(logPath, log);
  return { status: code === 0 && !timedOut ? "passed" : "failed", log };
}
