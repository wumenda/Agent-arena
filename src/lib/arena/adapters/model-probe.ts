import { execFile } from "node:child_process";
import { promisify } from "node:util";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const execFileP = promisify(execFile);

/**
 * harness 可用模型探测（仅服务端）：
 * - 有列举命令的走 CLI（opencode models / traecli models / qodercli --list-models / codebuddy --help）
 * - 没有的解析其本地全局配置（codex config.toml、claude settings.json）
 * - 全部失败时由调用方回退到 adapter.models 静态建议值
 */

/** 运行列举命令返回 stdout（Windows 统一 shell: true；超时兜底；失败返回空串） */
export async function runList(cmd: string, args: string[], timeoutMs = 8000): Promise<string> {
  return runCmd(cmd, args, timeoutMs);
}

/** 运行 `<cmd> --version`：ok=退出码 0（installed），detail=stdout/stderr（用于版本探测） */
export async function runVersion(cmd: string, timeoutMs = 8000): Promise<{ ok: boolean; detail: string }> {
  try {
    const { stdout, stderr } = await execFileP(cmd, ["--version"], { shell: true, timeout: timeoutMs });
    return { ok: true, detail: (stdout || stderr || "").trim() };
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; message?: string };
    return { ok: false, detail: (e.stdout || e.stderr || e.message || "").trim() };
  }
}

// 必须异步 execFile：同步 spawn 会阻塞事件循环，探测期间整站请求（含页面导航）全部排队
// shell:true 兼容 Windows .cmd shim（与 runner spawn 行为一致）
async function runCmd(cmd: string, args: string[], timeoutMs: number): Promise<string> {
  try {
    const { stdout } = await execFileP(cmd, args, { shell: true, timeout: timeoutMs });
    return stdout || "";
  } catch (err) {
    // 非零退出也尽量保留 stdout（个别 CLI 列举命令退出码不为 0 但输出有效）
    return (err as { stdout?: string }).stdout || "";
  }
}

/** 去重保序，剔除空白与 null/undefined */
export function uniq(items: unknown[]): string[] {
  return [...new Set(items.map((s) => (s == null ? "" : String(s).trim())).filter(Boolean))];
}

/** 每行一个模型的输出（opencode models / traecli models / qodercli --list-models） */
export function parseListOutput(text: string): string[] {
  return uniq(text.split(/\r?\n/));
}

/** TOML 中 key 恰为 model 的值（~/.codex/config.toml 顶层与 [profiles.*]；model_provider/model_reasoning_effort 不误匹配） */
export function parseTomlModels(text: string): string[] {
  return uniq([...text.matchAll(/^\s*model\s*=\s*"([^"]+)"/gm)].map((m) => m[1]));
}

/** codebuddy --help 的 "Currently supported: (a, b, c)" 逗号列表 */
export function parseCodebuddyHelp(text: string): string[] {
  const m = text.match(/Currently supported:\s*\(([^)]+)\)/);
  return m ? uniq(m[1]!.split(",")) : [];
}

/** ~/.claude/settings.json 的 env 模型映射；sonnet/opus/haiku 别名经 DEFAULT_*_MODEL 解析，恒列为候选 */
export function parseClaudeSettingsModels(text: string): string[] {
  const aliases = ["sonnet", "opus", "haiku"];
  try {
    const env = JSON.parse(text)?.env ?? {};
    const mapped = [
      env.ANTHROPIC_MODEL,
      env.ANTHROPIC_DEFAULT_OPUS_MODEL,
      env.ANTHROPIC_DEFAULT_SONNET_MODEL,
      env.ANTHROPIC_DEFAULT_HAIKU_MODEL,
    ].filter((v): v is string => typeof v === "string");
    return uniq([...mapped, ...aliases]);
  } catch {
    return aliases;
  }
}

/** 读用户主目录下的文件，不存在或不可读返回 null（只取模型字段，绝不外泄密钥内容） */
export function readHomeFile(...seg: string[]): string | null {
  try {
    const p = path.join(os.homedir(), ...seg);
    return fs.existsSync(p) ? fs.readFileSync(p, "utf8") : null;
  } catch {
    return null;
  }
}
