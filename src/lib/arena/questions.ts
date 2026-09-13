import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

// 题库布局：<题库根>/<题库>/<题目>/，题目目录即题目项目（开跑时整目录复制进运行工作目录）。
// 每层可选元信息文件：题库 bank.json { name, description }；题目 question.json { title, description, prompt }。
// 两个根：内置题库随仓库提交；用户题库在 .arena/questions（运行时数据，不入库）。
export function builtinBanksRoot(): string {
  return path.join(process.cwd(), "questions");
}

export function userBanksRoot(): string {
  return path.join(process.cwd(), ".arena", "questions");
}

export type QuestionSummary = {
  id: string; // 题目目录名（题库内唯一）
  title: string; // 展示名（question.json 的 title，缺省用目录名）
  description?: string;
  prompt?: string; // 选中后自动填入任务提示词
  hasTest: boolean; // 是否带测试套件（决定修复验证是否可跑）
};

export type BankSummary = {
  id: string; // 题库目录名（全局唯一 id）
  name: string; // 展示名（bank.json 的 name，缺省用目录名）
  description?: string;
  source: "builtin" | "user";
  questions: QuestionSummary[];
};

// 读取目录下的可选 JSON 元信息文件，缺失或解析失败一律返回空对象（题库是用户手放的，宽松处理）
function readMeta<T extends object>(dir: string, file: string): Partial<T> {
  const p = path.join(dir, file);
  if (!existsSync(p)) return {};
  try {
    const raw = JSON.parse(readFileSync(p, "utf8"));
    return typeof raw === "object" && raw !== null && !Array.isArray(raw) ? raw : {};
  } catch {
    return {};
  }
}

// 列出单个题库根下的全部题库；同名题库先到先得（用户根优先于内置根）
function scanBanksRoot(root: string, source: BankSummary["source"], taken: Set<string>): BankSummary[] {
  if (!existsSync(root)) return [];
  const banks: BankSummary[] = [];
  for (const entry of readdirSync(root)) {
    if (entry.startsWith(".")) continue;
    const bankDir = path.join(root, entry);
    if (!statSync(bankDir).isDirectory() || taken.has(entry)) continue;
    taken.add(entry);
    const bankMeta = readMeta<{ name: string; description: string }>(bankDir, "bank.json");
    const questions: QuestionSummary[] = [];
    for (const q of readdirSync(bankDir)) {
      if (q.startsWith(".") || q === "bank.json") continue;
      const qDir = path.join(bankDir, q);
      if (!statSync(qDir).isDirectory()) continue;
      const qMeta = readMeta<{ title: string; description: string; prompt: string }>(qDir, "question.json");
      let hasTest = false;
      const pkgPath = path.join(qDir, "package.json");
      if (existsSync(pkgPath)) {
        try {
          hasTest = Boolean(JSON.parse(readFileSync(pkgPath, "utf8"))?.scripts?.test);
        } catch {}
      }
      questions.push({
        id: q,
        title: qMeta.title || q,
        description: qMeta.description || undefined,
        prompt: qMeta.prompt || undefined,
        hasTest,
      });
    }
    questions.sort((a, b) => a.id.localeCompare(b.id));
    banks.push({
      id: entry,
      name: bankMeta.name || entry,
      description: bankMeta.description || undefined,
      source,
      questions,
    });
  }
  return banks.sort((a, b) => a.id.localeCompare(b.id));
}

// 全量题库列表：内置在前、用户题库在后（同名时用户覆盖内置）
export function listBanks(): BankSummary[] {
  const taken = new Set<string>();
  const user = scanBanksRoot(userBanksRoot(), "user", taken);
  const builtin = scanBanksRoot(builtinBanksRoot(), "builtin", taken);
  return [...builtin, ...user];
}

// 目录段合法性：只允许单个路径段，防路径穿越（题库内容来自磁盘扫描，引用来自客户端）
function safeSegment(s: string): boolean {
  return s.length > 0 && s.length <= 120 && !s.includes("/") && !s.includes("\\") && s !== "." && s !== "..";
}

// 把题库引用解析为题目目录绝对路径；查不到或名字非法返回 null
export function resolveQuestionDir(bank: string, id: string): string | null {
  if (!safeSegment(bank) || !safeSegment(id)) return null;
  for (const root of [userBanksRoot(), builtinBanksRoot()]) {
    const dir = path.join(root, bank, id);
    if (existsSync(dir) && statSync(dir).isDirectory()) return dir;
  }
  return null;
}
