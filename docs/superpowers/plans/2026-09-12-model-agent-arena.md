# Agent竞技场（model-agent-arena）实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** 个人本地 Web 工具：用户输入一条自由 prompt（或一句话描述对比需求，LLM 解析为可编辑配置），并排执行多个「harness × 模型」组合，实时直播各 agent 执行轨迹，结束后对比最终产出与客观指标（耗时/token/成本），全量历史可回放、可重跑。

**Architecture:** Next.js App Router 单进程全栈。自研轻量 runner（spawn 子进程 + 逐行解析各 harness 的 JSONL 事件流，归一化为统一 ArenaEvent）。实时直播走进程内 EventEmitter 总线 + SSE；持久化走 SQLite（对局/运行元数据）+ 每运行一个 `trajectory.jsonl` 文件（回放）。执行层通过 HarnessAdapter 接口抽象，MVP 实现 Claude Code、Codex CLI、OpenCode 三个 adapter。

**Tech Stack:** Next.js 15 (TypeScript, App Router, src 目录)、Tailwind CSS、Drizzle ORM + better-sqlite3、zod、p-limit、vitest（单元测试）、SSE（原生 ReadableStream）。

**关键约束（来自已确认共识，勿偏离）:**
- 执行：裸跑临时目录（无 Docker/Harbor，ADR-0001）；并行默认并发 3；单 Run 超时默认 15 分钟；单组合失败标记 `failed` 不阻塞其他组合。
- 一句话解析模型：火山方舟 OpenAI 兼容端点，配置见 `.agents/rules/apikey.md`，通过 `.env.local` 环境变量注入（`ARK_BASE_URL` / `ARK_API_KEY` / `ARK_MODEL=glm-5.3-flash`），**密钥不得写入任何入库文件**。
- 密钥只探测不管理（ADR 见 docs/adr/）；评测止步 L2；解析结果必须回显确认后才执行（ADR-0004）。
- 术语以 `CONTEXT.md` 为准：对局（Match）、运行（Run）、组合（Combo）、轨迹（Trajectory）、指标（Metrics）。

**环境注意（Windows + PowerShell 5）:** 所有命令在项目根执行。spawn Windows 下 CLI 是 `.cmd` shim，统一 `shell: true`。

---

## File Structure（最终形态）

```
(项目根 = c:\Users\Wumd\Desktop\新建文件夹)
.env.local                     # ARK_* 三变量（不入库）
.arena/                        # 运行时数据（不入库）：arena.db、runs/<matchId>/<runId>/
drizzle.config.ts
package.json / tsconfig.json / next.config.ts / vitest.config.ts
src/
  app/
    layout.tsx                 # 全局布局
    page.tsx                   # 配置页（一句话 + 手动表单 + 确认 + 成本预估）
    match/[id]/page.tsx         # 直播页（并排分栏 + 轨迹 + 指标 + diff）
    history/page.tsx            # 对局列表 + 回放入口
    api/
      matches/route.ts          # POST 创建对局并开跑 / GET 列表
      matches/[id]/route.ts     # GET 对局详情（runs + metrics + 状态）
      matches/[id]/stream/route.ts        # SSE 实时事件
      matches/[id]/trajectory/route.ts   # GET 单 run 轨迹回放（读文件）
      matches/[id]/rerun/route.ts        # POST 重跑
      parse/route.ts            # POST 一句话 → 配置
      detect/route.ts           # GET harness 安装/登录探测
  components/
    ConfigForm.tsx             # 可编辑表单（解析结果回显 + 手动模式共用）
    ComboGrid.tsx              # 直播页并排分栏容器
    RunPanel.tsx               # 单个 Run 的面板（状态/计时/轨迹）
    TrajectoryView.tsx         # 轨迹时间线（折叠渲染 ArenaEvent）
    MetricsBar.tsx             # 指标条（耗时/token/成本）
    DiffView.tsx               # 最终产出的文本/文件树对比
    ModelSelect.tsx            # harness×模型 选择控件
  lib/
    db/schema.ts               # Drizzle 表定义
    db/index.ts                # db client（单例）
    arena/types.ts             # ArenaEvent / Combo / RunMetrics 等领域类型
    arena/bus.ts               # EventEmitter 单例
    arena/runner.ts            # 执行引擎（并发/超时/失败/workdir）
    arena/estimator.ts         # 成本预估
    arena/parser.ts            # 一句话 → 配置（调 ark）
    arena/detect.ts            # harness 探测
    arena/adapters/registry.ts # adapter 注册表
    arena/adapters/claude-code.ts
    arena/adapters/codex.ts
    arena/adapters/opencode.ts
tests/
  fixtures/claude-code.jsonl  # 事件流样本
  fixtures/codex.jsonl
  adapters/claude-code.test.ts
  adapters/codex.test.ts
  arena/runner.test.ts
  arena/estimator.test.ts
  arena/parser.test.ts
```

---

### Task 0: 环境预检（手工验证，产出事实修正后续任务）

无代码。逐条在本机 PowerShell 验证，把实际输出记到本计划文件末尾的「预检记录」小节（直接编辑本文件追加）。

- [x] **Step 1:** 验证三个 CLI 存在及版本：`claude --version`、`codex --version`、`opencode --version`。若缺失，先安装：`npm install -g @anthropic-ai/claude-code`、`npm install -g @openai/codex`、`npm install -g opencode-ai`。
- [x] **Step 2:** 验证登录态：`claude -p "say ok" --output-format json`（返回 JSON 即已登录）；`codex exec "say ok" --json`；`opencode run "say ok" --model anthropic/claude-sonnet-4-5`。任一失败则先 `claude login` / `codex login` / 按提示登录。
- [x] **Step 3:** 确认事件流格式与计划中 fixture 一致：`claude -p "create hello.txt containing hi" --output-format stream-json --verbose` 输出若干 JSON 行（应有 `{"type":"assistant",...}` 与最后一行 `{"type":"result","total_cost_usd":...}`）；`codex exec "create hello.txt containing hi" --json -m <默认模型>` 输出 `{"type":"thread.started"...}` 等 JSONL。若实际字段名与本计划 fixture 不符，**以实测为准修正 Task 4/5 的解析代码再实施**。
- [x] **Step 4:** 确认 opencode 结构化输出能力：`opencode run --help`，若存在 `--json` 或类似 flag 则记录；不存在则 OpenCode adapter 按纯文本流实现（Task 6 已按此设计）。
- [x] **Step 5:** 验证 stdin 传 prompt 的可行性（runner 依赖此模式避免引号问题）：`"say ok" | claude -p --output-format json`；`"say ok" | codex exec - --json`；`"say ok" | opencode run - --model anthropic/claude-sonnet-4-5`。若某 CLI 不支持 `-` 从 stdin 读，记录下来，并把对应 adapter 的 `buildCommand` 改为把 prompt 直接放入 args（接受 shell:true 引号风险，prompt 含引号时可能有坑）。

### Task 1: 脚手架与工具链

**Files:**
- Create: `package.json`、`tsconfig.json`、`next.config.ts`、`vitest.config.ts`、`src/app/layout.tsx`、`src/app/page.tsx`、`.gitignore`（修改）

- [x] **Step 1:** 在项目根（目录已含 `.agents/`、`docs/`、`CONTEXT.md`，不与 create-next-app 冲突）执行：

```powershell
npx create-next-app@latest . --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes
```

若因非空目录被拒绝，则 `npx create-next-app@latest arena-tmp --typescript --tailwind --eslint --app --src-dir --import-alias "@/*" --use-npm --yes`，再把 `arena-tmp` 内全部条目移动到根目录后删除 `arena-tmp`。

- [x] **Step 2:** 安装依赖：

```powershell
npm install drizzle-orm better-sqlite3 zod p-limit
npm install -D drizzle-kit @types/better-sqlite3 @types/node vitest
```

- [x] **Step 3:** 创建 `vitest.config.ts`：

```ts
import { defineConfig } from "vitest/config";
import path from "node:path";

export default defineConfig({
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
  resolve: { alias: { "@": path.resolve(__dirname, "./src") } },
});
```

- [x] **Step 4:** `package.json` 的 scripts 增加 `"test": "vitest run"`；同时把 `package.json` 的 `name` 字段改为 `model-agent-arena`。

- [x] **Step 5:** `.gitignore` 追加两行：

```
.arena/
.env.local
```

- [x] **Step 6:** 创建 `.env.local`（内容来自 `.agents/rules/apikey.md`，不入库；密钥示例已脱敏，请用你自己的 ARK_API_KEY）：

```
ARK_BASE_URL=https://ark.cn-beijing.volces.com/api/plan/v3
ARK_API_KEY=XXX<your-api-key>
ARK_MODEL=glm-5.3-flash
```

- [x] **Step 7:** `git init`（若尚未）+ 首次提交：

```powershell
git add -A; git commit -m "chore: scaffold next.js app with drizzle and vitest"
```

- [x] **Step 8:** 冒烟验证：`npm run dev` 启动后访问 http://localhost:3000 出现 Next 默认页；`npm test` 通过（0 个测试文件也算通过）。

### Task 2: 数据库 schema 与 client

**Files:**
- Create: `src/lib/db/schema.ts`、`src/lib/db/index.ts`、`drizzle.config.ts`
- Test: `tests/db/schema.test.ts`

- [x] **Step 1:** 写失败测试 `tests/db/schema.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { createMatch, listMatches } from "@/lib/db/index";

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
});
```

- [x] **Step 2:** 运行 `npm test -- tests/db/schema.test.ts`，确认失败（模块不存在）。

- [x] **Step 3:** 创建 `src/lib/db/schema.ts`：

```ts
import { sqliteTable, text, integer, real } from "drizzle-orm/sqlite-core";

// 对局：一次提交的完整实验（同一条 prompt × 一组组合）
export const matches = sqliteTable("matches", {
  id: text("id").primaryKey(), // nanoid
  prompt: text("prompt").notNull(),
  combos: text("combos").notNull(), // JSON: {harness, model}[]
  status: text("status").notNull().default("pending"), // pending|running|completed|partial
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull().$defaultFn(() => new Date()),
});

// 运行：对局中单个「harness × 模型」组合的一次执行
export const runs = sqliteTable("runs", {
  id: text("id").primaryKey(),
  matchId: text("match_id").notNull(),
  harness: text("harness").notNull(),
  model: text("model").notNull(),
  status: text("status").notNull().default("pending"), // pending|running|completed|failed|timeout
  error: text("error"),
  workdir: text("workdir").notNull(),
  startedAt: integer("started_at", { mode: "timestamp_ms" }),
  finishedAt: integer("finished_at", { mode: "timestamp_ms" }),
  durationMs: integer("duration_ms"),
  tokensIn: integer("tokens_in"),
  tokensOut: integer("tokens_out"),
  costUsd: real("cost_usd"),
});

export type MatchRow = typeof matches.$inferSelect;
export type RunRow = typeof runs.$inferSelect;
```

（注意：nanoid 需 `npm install nanoid`；`costUsd` 使用 `real`。）

- [x] **Step 4:** 创建 `drizzle.config.ts`：

```ts
import { defineConfig } from "drizzle-kit";
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/lib/db/schema.ts",
  out: "./drizzle",
  dbCredentials: { url: ".arena/arena.db" },
});
```

- [x] **Step 5:** 创建 `src/lib/db/index.ts`（测试用内存库，生产用文件库）：

```ts
import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { matches, runs } from "./schema";
import { mkdirSync, existsSync } from "node:fs";
import path from "node:path";

function createDb(url: string) {
  if (url !== ":memory:") {
    const dir = path.dirname(url);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
  const sqlite = new Database(url);
  sqlite.pragma("journal_mode = WAL");
  const db = drizzle(sqlite);
  // drizzle-kit push 负责建表；此处直接执行 DDL 保证首次可用
  sqlite.exec(`
    CREATE TABLE IF NOT EXISTS matches (id TEXT PRIMARY KEY, prompt TEXT NOT NULL, combos TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at INTEGER NOT NULL);
    CREATE TABLE IF NOT EXISTS runs (id TEXT PRIMARY KEY, match_id TEXT NOT NULL, harness TEXT NOT NULL, model TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'pending', error TEXT, workdir TEXT NOT NULL, started_at INTEGER, finished_at INTEGER, duration_ms INTEGER, tokens_in INTEGER, tokens_out INTEGER, cost_usd REAL);
  `);
  return db;
}

const url = process.env.ARENA_DB ?? ".arena/arena.db";
export const db = createDb(url);

export function createMatch(input: { prompt: string; combos: { harness: string; model: string }[]; status?: string }) {
  const id = nanoid();
  db.insert(matches).values({ id, prompt: input.prompt, combos: JSON.stringify(input.combos), status: input.status ?? "pending" }).run();
  return getMatch(id)!;
}

export function getMatch(id: string) {
  return db.select().from(matches).where(eq(matches.id, id)).get();
}

export function listMatches() {
  return db.select().from(matches).orderBy(desc(matches.createdAt)).limit(200).all();
}

export function createRun(input: { id: string; matchId: string; harness: string; model: string; workdir: string }) {
  db.insert(runs).values({ ...input, status: "pending" }).run();
}

export function updateRun(id: string, patch: Partial<RunRow>) {
  db.update(runs).set(patch).where(eq(runs.id, id)).run();
}

export function listRuns(matchId: string) {
  return db.select().from(runs).where(eq(runs.matchId, matchId)).all();
}

export function updateMatch(id: string, patch: Partial<MatchRow>) {
  db.update(matches).set(patch).where(eq(matches.id, id)).run();
}
```

补 import：`import { eq, desc } from "drizzle-orm";`、`import type { MatchRow, RunRow } from "./schema";`、`import { customAlphabet } from "nanoid";` 并 `npm install nanoid`，加 `const nanoid = customAlphabet("abcdefghijklmnopqrstuvwxyz0123456789", 10);`。测试隔离：tests 中设 `process.env.ARENA_DB = ":memory:"` 于模块加载前（vitest 文件顶部先 `process.env.ARENA_DB=":memory:"` 再 `import "@/lib/db/index"`）。

- [x] **Step 6:** 运行 `npm test -- tests/db/schema.test.ts`，确认通过。

- [x] **Step 7:** 提交：`git add -A; git commit -m "feat: sqlite schema and db client for matches/runs"`

### Task 3: 领域类型（ArenaEvent / Combo / 指标）

**Files:**
- Create: `src/lib/arena/types.ts`
- Test: `tests/arena/types.test.ts`

- [x] **Step 1:** 写失败测试 `tests/arena/types.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { ComboSchema } from "@/lib/arena/types";

describe("ComboSchema", () => {
  it("accepts a known harness", () => {
    expect(() => ComboSchema.parse({ harness: "claude-code", model: "sonnet" })).not.toThrow();
  });
  it("rejects unknown harness", () => {
    expect(() => ComboSchema.parse({ harness: "trae-ide", model: "x" })).toThrow();
  });
});
```

- [x] **Step 2:** 运行确认失败（模块不存在）。

- [x] **Step 3:** 创建 `src/lib/arena/types.ts`：

```ts
import { z } from "zod";

export const HARNESS_IDS = ["claude-code", "codex", "opencode"] as const;
export type HarnessId = (typeof HARNESS_IDS)[number];

export const ComboSchema = z.object({
  harness: z.enum(HARNESS_IDS),
  model: z.string().min(1),
});
export type Combo = z.infer<typeof ComboSchema>;

export const MatchConfigSchema = z.object({
  prompt: z.string().min(1).max(20000),
  combos: z.array(ComboSchema).min(1).max(24),
});
export type MatchConfig = z.infer<typeof MatchConfigSchema>;

export type TokenUsage = { input: number; output: number; cacheRead?: number };

export type RunMetrics = {
  durationMs: number;
  tokensIn: number | null;
  tokensOut: number | null;
  costUsd: number | null;
};

// 归一化事件：所有 adapter 的输出都翻译成这一种形状
export type ArenaEvent =
  | { kind: "message"; text: string; ts: number }
  | { kind: "thinking"; text: string; ts: number }
  | { kind: "tool_call"; tool: string; input: unknown; ts: number }
  | { kind: "tool_result"; tool: string; output: string; isError?: boolean; ts: number }
  | { kind: "file_edit"; path: string; ts: number }
  | { kind: "command"; command: string; exitCode?: number; output?: string; ts: number }
  | { kind: "system"; text: string; ts: number }
  | { kind: "error"; text: string; ts: number }
  | { kind: "done"; usage?: TokenUsage; costUsd?: number; ts: number };

export type RunStatus = "pending" | "running" | "completed" | "failed" | "timeout";
export type DetectResult = { harness: HarnessId; installed: boolean; detail: string };
```

- [x] **Step 4:** 运行测试通过。

- [x] **Step 5:** 提交：`git add -A; git commit -m "feat: arena domain types and zod schemas"`

### Task 4: Claude Code adapter

**Files:**
- Create: `src/lib/arena/adapters/claude-code.ts`、`tests/fixtures/claude-code.jsonl`
- Test: `tests/adapters/claude-code.test.ts`

- [x] **Step 1:** 创建 fixture `tests/fixtures/claude-code.jsonl`（以 Task 0 实测为准，以下为标准格式样本）：

```
{"type":"system","subtype":"init","model":"claude-sonnet-4-5-20250929"}
{"type":"assistant","message":{"id":"msg_1","role":"assistant","content":[{"type":"thinking","thinking":"先创建文件"}]}}
{"type":"assistant","message":{"id":"msg_1","role":"assistant","content":[{"type":"tool_use","id":"toolu_1","name":"Write","input":{"file_path":"hello.txt","content":"hi"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result","tool_use_id":"toolu_1","content":"File created successfully"}]}}
{"type":"assistant","message":{"id":"msg_2","role":"assistant","content":[{"type":"text","text":"已创建 hello.txt"}]}}
{"type":"result","subtype":"success","total_cost_usd":0.0123,"duration_ms":45000,"num_turns":3,"usage":{"input_tokens":120,"output_tokens":80}}
```

- [x] **Step 2:** 写失败测试 `tests/adapters/claude-code.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { claudeCodeAdapter } from "@/lib/arena/adapters/claude-code";

const lines = readFileSync(path.join(__dirname, "../fixtures/claude-code.jsonl"), "utf8")
  .split("\n").filter(Boolean);

describe("claude-code adapter", () => {
  it("normalizes stream-json lines to ArenaEvents", () => {
    const parser = claudeCodeAdapter.createParser();
    const events = lines.flatMap((l) => parser.parse(l));
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("thinking");
    expect(kinds).toContain("file_edit");   // Write 工具调用 → file_edit
    expect(kinds).toContain("tool_result");
    expect(kinds).toContain("message");
    expect(kinds).toContain("done");
    const done = events.find((e) => e.kind === "done")!;
    expect(done.usage?.input).toBe(120);
    expect(done.costUsd).toBeCloseTo(0.0123);
  });

  it("builds headless command with model and workdir", () => {
    const cmd = claudeCodeAdapter.buildCommand(
      { harness: "claude-code", model: "sonnet" },
      "D:/tmp/run1"
    );
    expect(cmd.file).toBe("claude");
    expect(cmd.args).toContain("--output-format");
    expect(cmd.args).toContain("stream-json");
    expect(cmd.args).toContain("--model");
    expect(cmd.args).toContain("sonnet");
    expect(cmd.cwd).toBe("D:/tmp/run1");
  });
});
```

- [x] **Step 3:** 运行确认失败。

- [x] **Step 4:** 创建 adapter 接口文件 `src/lib/arena/adapters/registry.ts`（接口 + 注册表，本任务先放 claude-code，后续任务追加）：

```ts
import type { ArenaEvent, Combo, DetectResult, HarnessId } from "../types";

export interface LineParser {
  parse(line: string): ArenaEvent[];
}

export interface SpawnCommand {
  file: string;
  args: string[];
  cwd: string;
  stdin?: string;
  env?: Record<string, string>;
}

export interface HarnessAdapter {
  id: HarnessId;
  displayName: string;
  models: string[]; // 建议值，UI 允许自由输入
  detect(): Promise<DetectResult>;
  buildCommand(combo: Combo, workdir: string): SpawnCommand;
  createParser(): LineParser;
}
```

- [x] **Step 5:** 创建 `src/lib/arena/adapters/claude-code.ts`：

```ts
import { spawnSync } from "node:child_process";
import type { ArenaEvent, Combo } from "../types";
import type { HarnessAdapter, LineParser } from "./registry";

const now = () => Date.now();

export const claudeCodeAdapter: HarnessAdapter = {
  id: "claude-code",
  displayName: "Claude Code",
  models: ["sonnet", "opus", "haiku", "sonnet-4-5", "opus-4-1"],
  detect: async () => {
    const r = spawnSync("claude", ["--version"], { shell: true, encoding: "utf8" });
    return { harness: "claude-code", installed: r.status === 0, detail: (r.stdout || r.stderr || "").trim() };
  },
  buildCommand: (combo, workdir) => ({
    file: "claude",
    args: ["-p", "--output-format", "stream-json", "--verbose", "--model", combo.model],
    cwd: workdir,
    // prompt 走 stdin，避免 shell 引号问题
  }),
  createParser: (): LineParser => {
    const parse = (line: string): ArenaEvent[] => {
      let j: any;
      try { j = JSON.parse(line); } catch { return []; }
      const out: ArenaEvent[] = [];
      if (j.type === "assistant" && j.message?.content) {
        for (const c of j.message.content) {
          if (c.type === "text") out.push({ kind: "message", text: c.text ?? "", ts: now() });
          if (c.type === "thinking") out.push({ kind: "thinking", text: c.thinking ?? "", ts: now() });
          if (c.type === "tool_use") {
            out.push({ kind: "tool_call", tool: c.name, input: c.input, ts: now() });
            if (c.name === "Write" || c.name === "Edit") {
              out.push({ kind: "file_edit", path: String(c.input?.file_path ?? ""), ts: now() });
            }
          }
        }
      } else if (j.type === "user" && j.message?.content) {
        for (const c of j.message.content) {
          if (c.type === "tool_result") {
            out.push({
              kind: "tool_result",
              tool: "",
              output: typeof c.content === "string" ? c.content : JSON.stringify(c.content),
              isError: !!c.is_error,
              ts: now(),
            });
          }
        }
      } else if (j.type === "system") {
        out.push({ kind: "system", text: j.subtype ?? "", ts: now() });
      } else if (j.type === "result") {
        out.push({
          kind: "done",
          usage: j.usage ? { input: j.usage.input_tokens ?? 0, output: j.usage.output_tokens ?? 0 } : undefined,
          costUsd: j.total_cost_usd,
          ts: now(),
        });
      }
      return out;
    };
    return { parse };
  },
};
```

- [x] **Step 6:** 运行测试通过；若 Task 0 实测字段有差异，按实测修正。

- [x] **Step 7:** 提交：`git add -A; git commit -m "feat: claude code harness adapter"`

### Task 5: Codex adapter

**Files:**
- Create: `src/lib/arena/adapters/codex.ts`、`tests/fixtures/codex.jsonl`
- Test: `tests/adapters/codex.test.ts`

- [x] **Step 1:** 创建 fixture `tests/fixtures/codex.jsonl`（以 Task 0 实测为准）：

```
{"type":"thread.started","thread_id":"th_1"}
{"type":"turn.started"}
{"type":"item.completed","item":{"id":"i1","type":"agent_reasoning","text":"先看目录"}}
{"type":"item.completed","item":{"id":"i2","type":"command_execution","command":"ls","aggregated_output":"hello.txt\n","exit_code":0}}
{"type":"item.completed","item":{"id":"i3","type":"file_change","changes":[{"path":"hello.txt","kind":"add"}]}}
{"type":"item.completed","item":{"id":"i4","type":"agent_message","text":"已创建 hello.txt"}}
{"type":"turn.completed","usage":{"input_tokens":100,"cached_input_tokens":40,"output_tokens":60}}
```

- [x] **Step 2:** 写失败测试 `tests/adapters/codex.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { codexAdapter } from "@/lib/arena/adapters/codex";

const lines = readFileSync(path.join(__dirname, "../fixtures/codex.jsonl"), "utf8")
  .split("\n").filter(Boolean);

describe("codex adapter", () => {
  it("normalizes codex jsonl to ArenaEvents with usage on turn.completed", () => {
    const parser = codexAdapter.createParser();
    const events = lines.flatMap((l) => parser.parse(l));
    const kinds = events.map((e) => e.kind);
    expect(kinds).toContain("thinking");
    expect(kinds).toContain("command");
    expect(kinds).toContain("file_edit");
    expect(kinds).toContain("message");
    expect(kinds).toContain("done");
    const done = events.find((e) => e.kind === "done")!;
    expect(done.usage?.input).toBe(100);
    expect(done.usage?.output).toBe(60);
  });

  it("maps turn.failed and error to error events", () => {
    const parser = codexAdapter.createParser();
    const evs = parser.parse(JSON.stringify({ type: "turn.failed", error: { message: "boom" } }));
    expect(evs[0].kind).toBe("error");
  });

  it("builds exec command with model flag", () => {
    const cmd = codexAdapter.buildCommand({ harness: "codex", model: "gpt-5.2-codex" }, "D:/tmp/run2");
    expect(cmd.file).toBe("codex");
    expect(cmd.args[0]).toBe("exec");
    expect(cmd.args).toContain("--json");
    expect(cmd.args).toContain("-m");
    expect(cmd.cwd).toBe("D:/tmp/run2");
  });
});
```

- [x] **Step 3:** 运行确认失败。

- [x] **Step 4:** 先同步更新 `registry.ts` 的 `LineParser` 接口（增加可选 `flush`）：

```ts
export interface LineParser {
  parse(line: string): ArenaEvent[];
  flush?(): ArenaEvent[]; // 流结束时由 runner 调用（codex 的 done 事件在 turn.completed 才有 usage，此时才能发出）
}
```

- [x] **Step 5:** 创建 `src/lib/arena/adapters/codex.ts`（Codex 无单价 → costUsd 为 null，由指标层显示 n/a）：

```ts
import { spawnSync } from "node:child_process";
import type { ArenaEvent, Combo } from "../types";
import type { HarnessAdapter, LineParser } from "./registry";

const now = () => Date.now();

export const codexAdapter: HarnessAdapter = {
  id: "codex",
  displayName: "Codex CLI",
  models: ["gpt-5.2-codex", "gpt-5.2", "gpt-5.1-codex", "o4-mini"],
  detect: async () => {
    const r = spawnSync("codex", ["--version"], { shell: true, encoding: "utf8" });
    return { harness: "codex", installed: r.status === 0, detail: (r.stdout || r.stderr || "").trim() };
  },
  buildCommand: (combo, workdir) => ({
    file: "codex",
    args: ["exec", "-", "--json", "-m", combo.model, "--skip-git-repo-check"],
    cwd: workdir,
    stdin: "__PROMPT__", // runner 会把该占位符替换为对局 prompt（经 stdin 传入；若 Task 0 实测不支持 `-`，改为把 prompt 放进 args）
  }),
  createParser(): LineParser {
    let pendingUsage: { input: number; output: number } | undefined;
    const parse = (j: any): ArenaEvent[] => {
      const out: ArenaEvent[] = [];
      if (j.type === "item.completed") {
        const it = j.item;
        if (it?.type === "agent_message") out.push({ kind: "message", text: it.text ?? "", ts: now() });
        if (it?.type === "agent_reasoning" || it?.type === "reasoning") out.push({ kind: "thinking", text: it.text ?? "", ts: now() });
        if (it?.type === "command_execution") out.push({ kind: "command", command: it.command ?? "", exitCode: it.exit_code, output: it.aggregated_output, ts: now() });
        if (it?.type === "file_change") for (const ch of it.changes ?? []) out.push({ kind: "file_edit", path: ch.path, ts: now() });
      } else if (j.type === "turn.completed") {
        pendingUsage = { input: j.usage?.input_tokens ?? 0, output: j.usage?.output_tokens ?? 0 };
      } else if (j.type === "turn.failed" || j.type === "error") {
        out.push({ kind: "error", text: j.error?.message ?? JSON.stringify(j), ts: now() });
      }
      return out;
    };
    return {
      parse: (line: string): ArenaEvent[] => {
        try { return parse(JSON.parse(line)); } catch { return []; }
      },
      flush: (): ArenaEvent[] => {
        const done: ArenaEvent = { kind: "done", usage: pendingUsage, ts: now() };
        pendingUsage = undefined;
        return [done];
      },
    };
  },
};
```

- [x] **Step 6:** 在 `tests/adapters/codex.test.ts` 中追加 flush 断言：

```ts
it("flush emits done with pending usage", () => {
  const parser = codexAdapter.createParser();
  parser.parse(lines[lines.length - 1]); // turn.completed 行
  const flushed = parser.flush?.() ?? [];
  expect(flushed[0].kind).toBe("done");
  expect((flushed[0] as any).usage.input).toBe(100);
});
```

- [x] **Step 7:** 运行 `npm test -- tests/adapters/codex.test.ts` 全部通过（含 flush 断言；若 Task 0 实测字段有差异，按实测修正）。

- [x] **Step 8:** 提交：`git add -A; git commit -m "feat: codex harness adapter"`

### Task 6: OpenCode adapter（纯文本流模式）

**Files:**
- Create: `src/lib/arena/adapters/opencode.ts`
- Test: `tests/adapters/opencode.test.ts`

- [x] **Step 1:** 写失败测试：

```ts
import { describe, it, expect } from "vitest";
import { opencodeAdapter } from "@/lib/arena/adapters/opencode";

describe("opencode adapter", () => {
  it("emits message events for text chunks and done on flush", () => {
    const parser = opencodeAdapter.createParser();
    const evs = parser.parse("正在创建文件...");
    expect(evs[0].kind).toBe("message");
    expect((evs[0] as any).text).toContain("正在创建文件");
    expect(parser.flush?.()[0].kind).toBe("done");
  });
  it("builds run command with model", () => {
    const cmd = opencodeAdapter.buildCommand({ harness: "opencode", model: "zhipu/glm-4.6" }, "D:/tmp/run3");
    expect(cmd.file).toBe("opencode");
    expect(cmd.args[0]).toBe("run");
    expect(cmd.args).toContain("--model");
  });
});
```

- [x] **Step 2:** 运行确认失败。

- [x] **Step 3:** 创建 `src/lib/arena/adapters/opencode.ts`（若 Task 0 发现 `--json` 支持则升级为 JSONL 解析，接口不变）：

```ts
import { spawnSync } from "node:child_process";
import type { ArenaEvent, Combo } from "../types";
import type { HarnessAdapter, LineParser } from "./registry";

const now = () => Date.now();

export const opencodeAdapter: HarnessAdapter = {
  id: "opencode",
  displayName: "OpenCode",
  models: ["anthropic/claude-sonnet-4-5", "openai/gpt-5.2", "zhipu/glm-4.6", "deepseek/deepseek-chat"],
  detect: async () => {
    const r = spawnSync("opencode", ["--version"], { shell: true, encoding: "utf8" });
    return { harness: "opencode", installed: r.status === 0, detail: (r.stdout || r.stderr || "").trim() };
  },
  buildCommand: (combo, workdir) => ({
    file: "opencode",
    args: ["run", "-", "--model", combo.model],
    cwd: workdir,
    stdin: "__PROMPT__",
  }),
  createParser: (): LineParser => {
    let buffer = "";
    return {
      parse: (line: string): ArenaEvent[] => {
        buffer += line;
        return line.trim() ? [{ kind: "message", text: line, ts: now() }] : [];
      },
      flush: (): ArenaEvent[] => [{ kind: "done", ts: now() }], // 无 token/成本数据 → null
    };
  },
};
```

- [x] **Step 4:** 在 `registry.ts` 底部加注册表：

```ts
import { claudeCodeAdapter } from "./claude-code";
import { codexAdapter } from "./codex";
import { opencodeAdapter } from "./opencode";

export const adapters: Record<string, HarnessAdapter> = {
  [claudeCodeAdapter.id]: claudeCodeAdapter,
  [codexAdapter.id]: codexAdapter,
  [opencodeAdapter.id]: opencodeAdapter,
};
```

- [x] **Step 5:** 运行测试通过；提交：`git add -A; git commit -m "feat: opencode adapter and adapter registry"`

### Task 7: 事件总线与 Runner（执行引擎）

**Files:**
- Create: `src/lib/arena/bus.ts`、`src/lib/arena/runner.ts`
- Test: `tests/arena/runner.test.ts`

- [x] **Step 1:** 创建 `src/lib/arena/bus.ts`：

```ts
import { EventEmitter } from "node:events";

export type BusEvent =
  | { channel: "run-status"; matchId: string; runId: string; status: string; error?: string }
  | { channel: "run-event"; matchId: string; runId: string; event: import("./types").ArenaEvent }
  | { channel: "match-status"; matchId: string; status: string };

export const bus = new EventEmitter();
bus.setMaxListeners(100);
export const emit = (e: BusEvent) => bus.emit("arena", e);
export const subscribe = (fn: (e: BusEvent) => void) => {
  bus.on("arena", fn);
  return () => bus.off("arena", fn);
};
```

- [x] **Step 2:** 写失败测试 `tests/arena/runner.test.ts`（用 fake adapter，不依赖真实 CLI）：

```ts
process.env.ARENA_DB = ":memory:";
import { describe, it, expect, beforeEach } from "vitest";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { runMatch } from "@/lib/arena/runner";
import { listRuns, createMatch } from "@/lib/db/index";
import { subscribe } from "@/lib/arena/bus";
import fs from "node:fs";
import os from "node:os";

// fake harness：一个打印 JSONL 的 node 脚本
const fakeScript = path.join(os.tmpdir(), "arena-fake-harness.mjs");
fs.writeFileSync(fakeScript, `console.log(JSON.stringify({type:"text",text:"hi"}));`);

describe("runner", () => {
  beforeEach(() => { process.env.ARENA_WORKDIR_ROOT = fs.mkdtempSync(path.join(os.tmpdir(), "arena-")); });

  it("executes a match: runs complete, events captured, metrics persisted", async () => {
    const m = createMatch({ prompt: "say hi", combos: [{ harness: "claude-code", model: "x" }] });
    // 注入 fake：测试模式下 runner 使用 process.env.ARENA_FAKE_CMD 指定的命令
    process.env.ARENA_FAKE_CMD = `node ${fakeScript}`;
    const received: string[] = [];
    const unsub = subscribe((e) => { if (e.channel === "run-event") received.push(e.event.kind); });
    await runMatch(m.id);
    unsub();
    const runs = listRuns(m.id);
    expect(runs).toHaveLength(1);
    expect(runs[0].status).toBe("completed");
    expect(received).toContain("done");
    // 轨迹文件落盘
    const traj = fs.readFileSync(path.join(runs[0].workdir, "trajectory.jsonl"), "utf8");
    expect(traj).toContain("message");
  }, 30000);

  it("marks a failing combo as failed without blocking others", async () => {
    const m = createMatch({ prompt: "p", combos: [
      { harness: "claude-code", model: "x" },
      { harness: "codex", model: "y" },
    ]});
    // fake: claude-code 成功脚本、codex 失败脚本（退出码 1）
    const ok = path.join(os.tmpdir(), "arena-ok.mjs");
    const bad = path.join(os.tmpdir(), "arena-bad.mjs");
    fs.writeFileSync(ok, `console.log(JSON.stringify({type:"text",text:"ok"}))`);
    fs.writeFileSync(bad, `process.exit(1)`);
    process.env.ARENA_FAKE_CMD = `node ${ok}`;
    process.env.ARENA_FAKE_CMD_codex = `node ${bad}`;
    await runMatch(m.id);
    const runs = listRuns(m.id);
    const byHarness = Object.fromEntries(runs.map((r) => [r.harness, r.status]));
    expect(byHarness["claude-code"]).toBe("completed");
    expect(byHarness["codex"]).toBe("failed");
    const { getMatch } = await import("@/lib/db/index");
    expect(getMatch(m.id)!.status).toBe("partial");
  }, 30000);
});
```

- [x] **Step 3:** 运行确认失败。

- [x] **Step 4:** 创建 `src/lib/arena/runner.ts`：

```ts
import { spawn } from "node:child_process";
import { mkdirSync, appendFileSync } from "node:fs";
import path from "node:path";
import pLimit from "p-limit";
import { getMatch, createRun, updateRun, updateMatch, listRuns } from "@/lib/db";
import { adapters } from "./adapters/registry";
import { emit } from "./bus";
import type { ArenaEvent, Combo } from "./types";

const CONCURRENCY = Number(process.env.ARENA_CONCURRENCY ?? 3);
const TIMEOUT_MS = Number(process.env.ARENA_TIMEOUT_MS ?? 15 * 60 * 1000);

function workdirRoot() {
  return process.env.ARENA_WORKDIR_ROOT ?? ".arena/runs";
}

function killTree(pid: number) {
  if (process.platform === "win32") {
    spawn("taskkill", ["/pid", String(pid), "/T", "/F"], { shell: true });
  } else {
    try { process.kill(-pid, "SIGKILL"); } catch { try { process.kill(pid, "SIGKILL"); } catch {} }
  }
}

async function executeRun(matchId: string, prompt: string, combo: Combo, runId: string) {
  const adapter = adapters[combo.harness];
  const dir = path.join(workdirRoot(), matchId, runId);
  mkdirSync(dir, { recursive: true });
  createRun({ id: runId, matchId, harness: combo.harness, model: combo.model, workdir: dir });
  updateRun(runId, { status: "running", startedAt: new Date() });
  emit({ channel: "run-status", matchId, runId, status: "running" });

  const trajPath = path.join(dir, "trajectory.jsonl");
  const writeTraj = (ev: ArenaEvent) => appendFileSync(trajPath, JSON.stringify(ev) + "\n");

  // 测试注入点：ARENA_FAKE_CMD[_<harness>] 优先于真实命令
  const fake = process.env[`ARENA_FAKE_CMD_${combo.harness}`] ?? process.env.ARENA_FAKE_CMD;
  let file: string, args: string[], stdin: string | undefined;
  if (fake) {
    const parts = fake.split(" ");
    file = parts[0]; args = parts.slice(1); stdin = undefined;
  } else {
    const cmd = adapter.buildCommand(combo, dir);
    file = cmd.file; args = cmd.args;
    stdin = cmd.stdin === "__PROMPT__" ? prompt : cmd.stdin;
    if (file === "claude") stdin = prompt; // claude -p 从 stdin 读 prompt
  }

  const parser = adapter.createParser();
  const started = Date.now();
  let timedOut = false;

  await new Promise<void>((resolve) => {
    const child = spawn(file, args, { cwd: dir, shell: true, env: { ...process.env } });
    const timer = setTimeout(() => { timedOut = true; killTree(child.pid!); }, TIMEOUT_MS);
    const handleLine = (line: string) => {
      if (!line.trim()) return;
      const events = fake ? [{ kind: "message", text: line, ts: Date.now() } as ArenaEvent] : parser.parse(line);
      for (const ev of events) {
        writeTraj(ev);
        emit({ channel: "run-event", matchId, runId, event: ev });
        if (ev.kind === "done" && ev.usage) {
          updateRun(runId, { tokensIn: ev.usage.input, tokensOut: ev.usage.output, costUsd: ev.costUsd ?? null });
        }
      }
    };
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => chunk.split("\n").forEach(handleLine));
    child.stderr.setEncoding("utf8");
    child.stderr.on("data", (chunk: string) => chunk.split("\n").forEach((l) => { if (l.trim()) handleLine(JSON.stringify({ kind: "system", text: l, ts: Date.now() })); }));
    if (stdin) child.stdin.write(stdin, () => child.stdin.end());
    else child.stdin.end();
    child.on("error", (err) => {
      clearTimeout(timer);
      updateRun(runId, { status: "failed", error: String(err), finishedAt: new Date(), durationMs: Date.now() - started });
      emit({ channel: "run-status", matchId, runId, status: "failed", error: String(err) });
      resolve();
    });
    child.on("close", (code) => {
      clearTimeout(timer);
      const flushEvents = parser.flush?.() ?? [];
      for (const ev of flushEvents) { writeTraj(ev); emit({ channel: "run-event", matchId, runId, event: ev }); }
      const status = timedOut ? "timeout" : code === 0 ? "completed" : "failed";
      updateRun(runId, { status, finishedAt: new Date(), durationMs: Date.now() - started });
      emit({ channel: "run-status", matchId, runId, status });
      resolve();
    });
  });
}

export async function runMatch(matchId: string) {
  const match = getMatch(matchId);
  if (!match) throw new Error(`match ${matchId} not found`);
  updateMatch(matchId, { status: "running" });
  emit({ channel: "match-status", matchId, status: "running" });
  const combos: Combo[] = JSON.parse(match.combos);
  const limit = pLimit(CONCURRENCY);
  await Promise.all(combos.map((c, i) =>
    limit(() => executeRun(matchId, match.prompt, c, `r${i}_${Date.now().toString(36)}`)
      .catch(() => {/* executeRun 内部已落库失败态 */}))
  ));
  const finalRuns = listRuns(matchId);
  const allOk = finalRuns.every((r) => r.status === "completed");
  updateMatch(matchId, { status: allOk ? "completed" : "partial" });
  emit({ channel: "match-status", matchId, status: allOk ? "completed" : "partial" });
}
```

（注意：stderr 处理里对非 JSON 行做 system 事件包装；claude 的 stdin 分支已并入 fake 判断之后。）

- [x] **Step 5:** 运行 `npm test -- tests/arena/runner.test.ts` 通过（超时 30s）。

- [x] **Step 6:** 提交：`git add -A; git commit -m "feat: arena runner with concurrency, timeout and failure isolation"`

### Task 8: 成本预估

**Files:**
- Create: `src/lib/arena/estimator.ts`
- Test: `tests/arena/estimator.test.ts`

- [x] **Step 1:** 写失败测试：

```ts
import { describe, it, expect } from "vitest";
import { estimateCost } from "@/lib/arena/estimator";

describe("estimateCost", () => {
  it("scales with combo count by model tier", () => {
    const cheap = estimateCost([{ harness: "opencode", model: "zhipu/glm-4.6" }]);
    const pricey = estimateCost([{ harness: "claude-code", model: "opus" }]);
    expect(cheap.high).toBeLessThan(pricey.high);
    const two = estimateCost([
      { harness: "claude-code", model: "opus" },
      { harness: "claude-code", model: "opus" },
    ]);
    expect(two.low).toBeCloseTo(pricey.low * 2);
  });
});
```

- [x] **Step 2:** 运行确认失败。

- [x] **Step 3:** 创建 `src/lib/arena/estimator.ts`：

```ts
import type { Combo } from "./types";

const TIERS = [
  { re: /opus|gpt-5\.[12]|o4/i, low: 0.5, high: 2.0 },
  { re: /sonnet|gpt-5\.1|glm|deepseek|qwen/i, low: 0.1, high: 0.6 },
  { re: /haiku|mini|flash/i, low: 0.02, high: 0.1 },
  { re: /.*/, low: 0.1, high: 0.8 },
];

function tier(model: string) {
  return TIERS.find((t) => t.re.test(model))!;
}

export function estimateCost(combos: Combo[]): { low: number; high: number } {
  let low = 0, high = 0;
  for (const c of combos) {
    const t = tier(c.model);
    low += t.low;
    high += t.high;
  }
  return { low: Math.round(low * 100) / 100, high: Math.round(high * 100) / 100 };
}
```

- [x] **Step 4:** 测试通过；提交：`git add -A; git commit -m "feat: cost estimator for match confirmation"`

### Task 9: 一句话解析（LLM → MatchConfig）

**Files:**
- Create: `src/lib/arena/parser.ts`
- Test: `tests/arena/parser.test.ts`

- [x] **Step 1:** 写失败测试（mock fetch，不打真网）：

```ts
import { describe, it, expect, vi } from "vitest";
import { parseNaturalLanguage } from "@/lib/arena/parser";

function okResponse(content: string) {
  return { ok: true, json: async () => ({ choices: [{ message: { content } }] }) };
}

describe("parseNaturalLanguage", () => {
  it("parses valid JSON from the model into a MatchConfig", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okResponse(
      JSON.stringify({ prompt: "写一个贪吃蛇", combos: [{ harness: "claude-code", model: "sonnet" }, { harness: "codex", model: "gpt-5.2-codex" }] })
    )));
    const cfg = await parseNaturalLanguage("对比 claude code 和 codex 写贪吃蛇");
    expect(cfg?.combos).toHaveLength(2);
    expect(cfg?.prompt).toBe("写一个贪吃蛇");
    vi.unstubAllGlobals();
  });

  it("returns null on invalid model output", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => okResponse("这不是 JSON")));
    expect(await parseNaturalLanguage("随便")).toBeNull();
    vi.unstubAllGlobals();
  });
});
```

- [x] **Step 2:** 运行确认失败。

- [x] **Step 3:** 创建 `src/lib/arena/parser.ts`：

```ts
import { MatchConfigSchema, type MatchConfig } from "./types";

const SYSTEM_PROMPT = `你是"Agent竞技场"的实验配置解析器。用户用一句话描述想做的模型/harness 对比实验。
输出严格的 JSON（不要 markdown 代码块包裹）：
{"prompt": string, "combos": [{"harness": string, "model": string}]}
规则：
- harness 只能取 "claude-code" | "codex" | "opencode"
- model 使用各 harness 的模型标识：claude-code 如 "sonnet"/"opus"/"haiku"；codex 如 "gpt-5.2-codex"；opencode 如 "anthropic/claude-sonnet-4-5"、"zhipu/glm-4.6"、"openai/gpt-5.2"
- 用户未指定模型时给该 harness 的默认模型；未指定 harness 时默认三个全选
- prompt 是去掉"对比/比较"等指令性措辞后的任务本体`;

export async function parseNaturalLanguage(input: string): Promise<MatchConfig | null> {
  const base = process.env.ARK_BASE_URL;
  const key = process.env.ARK_API_KEY;
  const model = process.env.ARK_MODEL ?? "glm-5.3-flash";
  if (!base || !key) return null;
  try {
    const res = await fetch(`${base}/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: input },
        ],
        temperature: 0,
      }),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const content: string = data.choices?.[0]?.message?.content ?? "";
    const jsonText = content.replace(/^```(?:json)?\s*/m, "").replace(/```\s*$/m, "").trim();
    const start = jsonText.indexOf("{");
    const end = jsonText.lastIndexOf("}");
    if (start === -1 || end === -1) return null;
    const parsed = MatchConfigSchema.safeParse(JSON.parse(jsonText.slice(start, end + 1)));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
```

- [x] **Step 4:** 测试通过；提交：`git add -A; git commit -m "feat: natural language match config parser via ark"`

### Task 10: API 路由（创建/列表/详情/SSE/回放/重跑/探测/解析）

**Files:**
- Create: `src/app/api/matches/route.ts`、`src/app/api/matches/[id]/route.ts`、`src/app/api/matches/[id]/stream/route.ts`、`src/app/api/matches/[id]/trajectory/route.ts`、`src/app/api/matches/[id]/rerun/route.ts`、`src/app/api/parse/route.ts`、`src/app/api/detect/route.ts`

- [x] **Step 1:** `src/app/api/parse/route.ts`：

```ts
import { NextRequest, NextResponse } from "next/server";
import { parseNaturalLanguage } from "@/lib/arena/parser";

export async function POST(req: NextRequest) {
  const { input } = await req.json();
  if (typeof input !== "string" || !input.trim()) {
    return NextResponse.json({ error: "input required" }, { status: 400 });
  }
  const config = await parseNaturalLanguage(input);
  return NextResponse.json({ config }); // config 可能为 null，前端回退手动表单
}
```

- [x] **Step 2:** `src/app/api/detect/route.ts`：

```ts
import { NextResponse } from "next/server";
import { adapters } from "@/lib/arena/adapters/registry";

export async function GET() {
  const results = await Promise.all(Object.values(adapters).map((a) => a.detect()));
  return NextResponse.json({ results });
}
```

- [x] **Step 3:** `src/app/api/matches/route.ts`（POST 创建即开跑、立即返回对局 id；GET 列表）：

```ts
import { NextRequest, NextResponse } from "next/server";
import { MatchConfigSchema } from "@/lib/arena/types";
import { createMatch, listMatches } from "@/lib/db";
import { runMatch } from "@/lib/arena/runner";

export async function GET() {
  return NextResponse.json({ matches: listMatches() });
}

export async function POST(req: NextRequest) {
  const body = await req.json();
  const parsed = MatchConfigSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
  }
  const match = createMatch(parsed.data);
  // 后台执行，不阻塞响应
  void runMatch(match.id);
  return NextResponse.json({ match }, { status: 201 });
}
```

- [x] **Step 4:** `src/app/api/matches/[id]/route.ts`：

```ts
import { NextRequest, NextResponse } from "next/server";
import { getMatch, listRuns } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const match = getMatch(id);
  if (!match) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({ match, runs: listRuns(id) });
}
```

- [x] **Step 5:** `src/app/api/matches/[id]/stream/route.ts`（SSE）：

```ts
import { NextRequest } from "next/server";
import { subscribe, type BusEvent } from "@/lib/arena/bus";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      const send = (e: BusEvent) => {
        if ("matchId" in e && e.matchId === id) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
        }
      };
      const unsub = subscribe(send);
      const ping = setInterval(() => controller.enqueue(encoder.encode(": ping\n\n")), 20000);
      req.signal.addEventListener("abort", () => {
        clearInterval(ping);
        unsub();
        controller.close();
      });
    },
  });
  return new Response(stream, {
    headers: { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive" },
  });
}
```

- [x] **Step 6:** `src/app/api/matches/[id]/trajectory/route.ts`（回放）：

```ts
import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getMatch, listRuns } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const match = getMatch(id);
  if (!match) return NextResponse.json({ error: "not found" }, { status: 404 });
  const runId = req.nextUrl.searchParams.get("runId");
  const run = listRuns(id).find((r) => r.id === runId);
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });
  try {
    const traj = readFileSync(path.join(run.workdir, "trajectory.jsonl"), "utf8");
    return NextResponse.json({ events: traj.split("\n").filter(Boolean).map((l) => JSON.parse(l)) });
  } catch {
    return NextResponse.json({ events: [] });
  }
}
```

- [x] **Step 7:** `src/app/api/matches/[id]/rerun/route.ts`（同 prompt 同组合新对局）：

```ts
import { NextRequest, NextResponse } from "next/server";
import { getMatch, createMatch } from "@/lib/db";
import { runMatch } from "@/lib/arena/runner";

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const old = getMatch(id);
  if (!old) return NextResponse.json({ error: "not found" }, { status: 404 });
  const match = createMatch({ prompt: old.prompt, combos: JSON.parse(old.combos) });
  void runMatch(match.id);
  return NextResponse.json({ match }, { status: 201 });
}
```

- [x] **Step 8:** 手工冒烟：`npm run dev` 后
  - `curl http://localhost:3000/api/detect` 返回三个 harness 探测结果
  - `curl -X POST http://localhost:3000/api/matches -H "Content-Type: application/json" -d "{\"prompt\":\"say ok\",\"combos\":[{\"harness\":\"claude-code\",\"model\":\"sonnet\"}]}"` 返回 201 与 match id
  - 浏览器开 `http://localhost:3000/api/matches/<id>/stream` 能看到 SSE 数据流入

- [x] **Step 9:** 提交：`git add -A; git commit -m "feat: api routes for matches, sse stream, trajectory replay, rerun, detect, parse"`

### Task 11: 前端——配置页（一句话 + 表单 + 确认）

**Files:**
- Create: `src/components/ConfigForm.tsx`、`src/components/ModelSelect.tsx`
- Modify: `src/app/page.tsx`

- [x] **Step 1:** 创建 `src/components/ModelSelect.tsx`：

```tsx
"use client";
import { adapters } from "@/lib/arena/adapters/registry";

export default function ModelSelect({
  value, onChange,
}: { value: { harness: string; model: string }; onChange: (v: { harness: string; model: string }) => void }) {
  return (
    <div className="flex gap-2">
      <select
        className="border rounded px-2 py-1 text-sm"
        value={value.harness}
        onChange={(e) => {
          const h = e.target.value;
          const def = adapters[h]?.models[0] ?? "";
          onChange({ harness: h, model: def });
        }}
      >
        {Object.values(adapters).map((a) => (
          <option key={a.id} value={a.id}>{a.displayName}</option>
        ))}
      </select>
      <input
        className="border rounded px-2 py-1 text-sm flex-1"
        list={`models-${value.harness}`}
        value={value.model}
        onChange={(e) => onChange({ ...value, model: e.target.value })}
        placeholder="模型标识"
      />
      <datalist id={`models-${value.harness}`}>
        {(adapters[value.harness]?.models ?? []).map((m) => <option key={m} value={m} />)}
      </datalist>
    </div>
  );
}
```

- [x] **Step 2:** 创建 `src/components/ConfigForm.tsx`（解析结果回显为可编辑表单；确认前显示预估成本——ADR-0004）：

```tsx
"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import ModelSelect from "./ModelSelect";
import { estimateCost } from "@/lib/arena/estimator";
import type { MatchConfig } from "@/lib/arena/types";

export default function ConfigForm({ initial }: { initial?: MatchConfig | null }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [combos, setCombos] = useState<{ harness: string; model: string }[]>(
    initial?.combos ?? [{ harness: "claude-code", model: "sonnet" }]
  );
  const [submitting, setSubmitting] = useState(false);
  const est = estimateCost(combos);

  const start = async () => {
    setSubmitting(true);
    const res = await fetch("/api/matches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, combos }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (res.ok) router.push(`/match/${data.match.id}`);
  };

  return (
    <div className="space-y-4">
      <textarea
        className="w-full border rounded p-3 font-mono text-sm"
        rows={5}
        placeholder="任务提示词，如：写一个贪吃蛇游戏，单文件 HTML"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />
      <div className="space-y-2">
        {combos.map((c, i) => (
          <div key={i} className="flex items-center gap-2">
            <ModelSelect value={c} onChange={(v) => setCombos(combos.map((x, j) => (j === i ? v : x)))} />
            <button className="text-red-500" onClick={() => setCombos(combos.filter((_, j) => j !== i))}>删除</button>
          </div>
        ))}
        <button className="border rounded px-3 py-1 text-sm" onClick={() => setCombos([...combos, { harness: "opencode", model: "zhipu/glm-4.6" }])}>+ 添加组合</button>
      </div>
      <div className="text-sm text-gray-600">
        预估成本：${est.low} – ${est.high}（{combos.length} 个组合并行，单运行超时 15 分钟）
      </div>
      <button
        className="bg-blue-600 text-white rounded px-4 py-2 disabled:opacity-50"
        disabled={!prompt.trim() || combos.length === 0 || submitting}
        onClick={start}
      >
        {submitting ? "启动中…" : "确认开跑"}
      </button>
    </div>
  );
}
```

- [x] **Step 3:** 重写 `src/app/page.tsx`（一句话解析 + 表单）：

```tsx
"use client";
import { useEffect, useState } from "react";
import ConfigForm from "@/components/ConfigForm";
import type { MatchConfig } from "@/lib/arena/types";

export default function Home() {
  const [input, setInput] = useState("");
  const [parsing, setParsing] = useState(false);
  const [config, setConfig] = useState<MatchConfig | null>(null);
  const [parseError, setParseError] = useState("");
  const [detect, setDetect] = useState<{ harness: string; installed: boolean; detail: string }[]>([]);

  useEffect(() => {
    fetch("/api/detect").then((r) => r.json()).then((d) => setDetect(d.results ?? []));
  }, []);

  const parse = async () => {
    setParsing(true);
    setParseError("");
    const res = await fetch("/api/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input }),
    });
    const data = await res.json();
    setParsing(false);
    if (data.config) setConfig(data.config);
    else setParseError("解析失败，请手动配置（或检查 .env.local 的 ARK_* 配置）");
  };

  return (
    <main className="max-w-3xl mx-auto p-8 space-y-6">
      <h1 className="text-2xl font-bold">Agent 竞技场</h1>
      <div className="text-xs text-gray-500">
        {detect.map((d) => (
          <span key={d.harness} className="mr-3">{d.installed ? "✅" : "❌"} {d.harness}</span>
        ))}
      </div>
      <div className="space-y-2">
        <textarea
          className="w-full border rounded p-3 text-sm"
          rows={2}
          placeholder="一句话描述对比，如：对比 claude code 和 codex 写一个贪吃蛇"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="border rounded px-3 py-1 text-sm disabled:opacity-50" disabled={parsing || !input.trim()} onClick={parse}>
          {parsing ? "解析中…" : "解析"}
        </button>
        {parseError && <div className="text-sm text-red-500">{parseError}</div>}
      </div>
      <hr />
      <ConfigForm initial={config} />
    </main>
  );
}
```

- [x] **Step 4:** 手工验证：`npm run dev` 打开首页 → 显示三个 harness 探测状态 → 点「解析」回填表单 → 改模型 → 显示预估成本 → 「确认开跑」跳转直播页。

- [x] **Step 5:** 提交：`git add -A; git commit -m "feat: match config page with nl parsing and cost estimate"`

### Task 12: 前端——直播页（SSE + 并排分栏 + 轨迹 + 指标）

**Files:**
- Create: `src/app/match/[id]/page.tsx`、`src/components/ComboGrid.tsx`、`src/components/RunPanel.tsx`、`src/components/TrajectoryView.tsx`、`src/components/MetricsBar.tsx`、`src/components/DiffView.tsx`

- [x] **Step 1:** 创建 `src/components/TrajectoryView.tsx`：

```tsx
"use client";
import type { ArenaEvent } from "@/lib/arena/types";

function EventLine({ e }: { e: ArenaEvent }) {
  const color =
    e.kind === "message" ? "text-gray-800" :
    e.kind === "thinking" ? "text-purple-600" :
    e.kind === "tool_call" || e.kind === "file_edit" ? "text-blue-600" :
    e.kind === "tool_result" || e.kind === "command" ? "text-gray-500" :
    e.kind === "error" ? "text-red-600" : "text-gray-400";
  const text =
    e.kind === "message" ? e.text :
    e.kind === "thinking" ? `思考：${e.text.slice(0, 200)}` :
    e.kind === "tool_call" ? `调用工具 ${e.tool}` :
    e.kind === "tool_result" ? `工具返回：${e.output.slice(0, 200)}` :
    e.kind === "file_edit" ? `编辑文件 ${e.path}` :
    e.kind === "command" ? `执行命令 ${e.command}（退出码 ${e.exitCode ?? "?"}）` :
    e.kind === "system" ? `[系统] ${e.text}` :
    e.kind === "error" ? `错误：${e.text}` : "完成";
  return <div className={`${color} font-mono text-xs truncate`} title={text}>{text}</div>;
}

export default function TrajectoryView({ events }: { events: ArenaEvent[] }) {
  return (
    <div className="h-48 overflow-y-auto border rounded bg-gray-50 p-2 space-y-1">
      {events.length === 0 && <div className="text-xs text-gray-400">等待事件…</div>}
      {events.map((e, i) => <EventLine key={i} e={e} />)}
    </div>
  );
}
```

- [x] **Step 2:** 创建 `src/components/MetricsBar.tsx`：

```tsx
"use client";

export default function MetricsBar({
  durationMs, tokensIn, tokensOut, costUsd,
}: { durationMs: number | null; tokensIn: number | null; tokensOut: number | null; costUsd: number | null }) {
  const fmt = (ms: number) => ms > 60000 ? `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s` : `${(ms / 1000).toFixed(1)}s`;
  return (
    <div className="flex gap-4 text-xs text-gray-600">
      <span>⏱ {durationMs != null ? fmt(durationMs) : "—"}</span>
      <span> tokens: {tokensIn != null ? `${tokensIn} → ${tokensOut}` : "n/a"}</span>
      <span> 💰 {costUsd != null ? `$${costUsd.toFixed(4)}` : "n/a"}</span>
    </div>
  );
}
```

- [x] **Step 3:** 创建 `src/components/DiffView.tsx`（MVP：展示产出的文件树与最终 message；完整 diff 留 v2）：

```tsx
"use client";
import type { ArenaEvent } from "@/lib/arena/types";

export default function DiffView({ events }: { events: ArenaEvent[] }) {
  const files = [...new Set(events.filter((e) => e.kind === "file_edit").map((e) => (e as any).path as string))];
  const finalMessage = [...events].reverse().find((e) => e.kind === "message") as { text: string } | undefined;
  return (
    <div className="space-y-2">
      {files.length > 0 && (
        <div className="text-xs">
          <div className="font-semibold">产出文件：</div>
          {files.map((f) => <div key={f} className="font-mono text-blue-700">{f}</div>)}
        </div>
      )}
      {finalMessage && (
        <div className="text-xs border rounded p-2 bg-white">
          <div className="font-semibold">最终回答：</div>
          <div className="whitespace-pre-wrap">{finalMessage.text}</div>
        </div>
      )}
    </div>
  );
}
```

- [x] **Step 4:** 创建 `src/components/RunPanel.tsx`：

```tsx
"use client";
import TrajectoryView from "./TrajectoryView";
import MetricsBar from "./MetricsBar";
import DiffView from "./DiffView";
import type { ArenaEvent } from "@/lib/arena/types";
import type { RunRow } from "@/lib/db/schema";

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-gray-200", running: "bg-blue-100 animate-pulse",
  completed: "bg-green-100", failed: "bg-red-100", timeout: "bg-yellow-100",
};

export default function RunPanel({ run, events }: { run: RunRow; events: ArenaEvent[] }) {
  return (
    <div className="border rounded-lg p-3 space-y-2 min-w-72">
      <div className="flex items-center justify-between">
        <div className="font-semibold text-sm">{run.harness} · {run.model}</div>
        <span className={`text-xs rounded px-2 py-0.5 ${STATUS_STYLE[run.status] ?? "bg-gray-100"}`}>{run.status}</span>
      </div>
      {run.error && <div className="text-xs text-red-600">{run.error}</div>}
      <MetricsBar durationMs={run.durationMs} tokensIn={run.tokensIn} tokensOut={run.tokensOut} costUsd={run.costUsd} />
      <TrajectoryView events={events} />
      {(run.status === "completed" || run.status === "timeout") && <DiffView events={events} />}
    </div>
  );
}
```

- [x] **Step 5:** 创建 `src/app/match/[id]/page.tsx`（SSE 订阅 + 轮询兜底）：

```tsx
"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import RunPanel from "@/components/RunPanel";
import type { ArenaEvent } from "@/lib/arena/types";
import type { RunRow } from "@/lib/db/schema";

export default function MatchPage() {
  const { id } = useParams<{ id: string }>();
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [events, setEvents] = useState<Record<string, ArenaEvent[]>>({});
  const [matchStatus, setMatchStatus] = useState("…");

  useEffect(() => {
    const load = async () => {
      const res = await fetch(`/api/matches/${id}`);
      if (res.ok) {
        const { match, runs } = await res.json();
        setRuns(runs);
        setMatchStatus(match.status);
        // 兜底回放：拉历史轨迹（刷新/断流后仍有数据）
        for (const r of runs) {
          if (!events[r.id] || events[r.id]!.length === 0) {
            const t = await fetch(`/api/matches/${id}/trajectory?runId=${r.id}`);
            const d = await t.json();
            if (d.events?.length) setEvents((prev) => ({ ...prev, [r.id]: d.events }));
          }
        }
      }
    };
    load();
    const poll = setInterval(load, 5000);
    const es = new EventSource(`/api/matches/${id}/stream`);
    es.onmessage = (m) => {
      const e = JSON.parse(m.data);
      if (e.channel === "run-event") {
        setEvents((prev) => ({ ...prev, [e.runId]: [...(prev[e.runId] ?? []), e.event] }));
      } else if (e.channel === "run-status") {
        setRuns((prev) => prev.map((r) => (r.id === e.runId ? { ...r, status: e.status, error: e.error ?? r.error } : r)));
      } else if (e.channel === "match-status") {
        setMatchStatus(e.status);
      }
    };
    return () => { clearInterval(poll); es.close(); };
  }, [id]);

  const rerun = async () => {
    const res = await fetch(`/api/matches/${id}/rerun`, { method: "POST" });
    const d = await res.json();
    if (res.ok) window.location.href = `/match/${d.match.id}`;
  };

  return (
    <main className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">对局 {id} · {matchStatus}</h1>
        <button className="border rounded px-3 py-1 text-sm" onClick={rerun}>一键重跑（看方差）</button>
      </div>
      <div className="flex gap-4 overflow-x-auto">
        {runs.map((r) => (
          <RunPanel key={r.id} run={r} events={events[r.id] ?? []} />
        ))}
        {runs.length === 0 && <div className="text-gray-500">等待运行启动…</div>}
      </div>
    </main>
  );
}
```

- [x] **Step 6:** 手工端到端验收：首页提交单组合（claude-code/sonnet，prompt「create hello.txt containing hi」）→ 直播页出现运行面板 → 轨迹实时滚动 → 结束后显示指标与产出 → 点「一键重跑」生成新对局。

- [x] **Step 7:** 提交：`git add -A; git commit -m "feat: live match page with sse trajectory streaming and metrics"`

### Task 13: 前端——历史页

**Files:**
- Create: `src/app/history/page.tsx`

- [x] **Step 1:** 创建页面：

```tsx
"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type MatchRow = { id: string; prompt: string; combos: string; status: string; createdAt: string };

export default function HistoryPage() {
  const [matches, setMatches] = useState<MatchRow[]>([]);
  useEffect(() => {
    fetch("/api/matches").then((r) => r.json()).then((d) => setMatches(d.matches ?? []));
  }, []);
  return (
    <main className="max-w-4xl mx-auto p-8 space-y-4">
      <h1 className="text-xl font-bold">历史对局</h1>
      {matches.length === 0 && <div className="text-gray-500">还没有对局</div>}
      {matches.map((m) => (
        <Link key={m.id} href={`/match/${m.id}`} className="block border rounded p-3 hover:bg-gray-50">
          <div className="font-mono text-xs text-gray-400">{m.id} · {m.status} · {new Date(m.createdAt).toLocaleString()}</div>
          <div className="text-sm truncate">{m.prompt}</div>
          <div className="text-xs text-gray-500">{JSON.parse(m.combos).map((c: any) => `${c.harness}×${c.model}`).join("，")}</div>
        </Link>
      ))}
    </main>
  );
}
```

- [x] **Step 2:** 在首页 header 加历史入口：修改 `src/app/page.tsx` 的 `<h1>` 行后追加：

```tsx
<div className="text-sm"><a className="text-blue-600 underline" href="/history">历史对局</a></div>
```

- [x] **Step 3:** 手工验收：跑完一个对局后，历史页出现条目，点击可回看（复用直播页的兜底回放逻辑，此时走 trajectory 文件）。

- [x] **Step 4:** 提交：`git add -A; git commit -m "feat: match history page"`

### Task 14: 端到端验收

- [x] **Step 1:** `npm test` 全绿。
- [x] **Step 2:** 完整走一遍用户旅程：一句话「对比 claude code 和 codex 以及 opencode 的 glm-4.6，写一个单文件 HTML 贪吃蛇」→ 解析回显 → 调整确认 → 直播页三栏并行 → 全部结束后指标/diff 对比 → 历史页回放 → 一键重跑。
- [x] **Step 3:** 异常路径：改一个组合的模型为不存在值 → 该 Run 标记 failed 且其他组合正常完成（对局 partial）。
- [x] **Step 4:** 提交（如有修复）：`git add -A; git commit -m "fix: e2e acceptance fixes"`

---

## 预检记录（Task 0 执行时填写）

（保留此节，Task 0 的实测输出追加于此，作为 fixture 修正依据）

### 实测结果（2026-09-12，Windows + PowerShell 5）

**Step 1 — CLI 版本：**
- claude：2.1.195 ✓
- codex：未安装 → `npm install -g @openai/codex` 后为 codex-cli 0.154.0 ✓
- opencode：1.18.5 ✓

**Step 2 — 登录态：**
- claude：CLI 无头运行正常（JSON 输出正常），但 Ark CodingPlan 订阅无效（API 400，account 2102973059 订阅过期）。事件格式验证不受影响；真实对局会以 result.is_error=true 收场，直至订阅恢复。
- codex：CLI 正常，配置的后端 https://www.xmapi.cc 暂时 503（第三方 provider 不可用，非 CLI 问题）。
- opencode：正常 ✓（实际可用模型：`ark/glm-5.2` + 若干 opencode 免费模型；无 anthropic/*）。

**Step 3 — 事件流格式：**
- claude `--output-format stream-json --verbose`：与计划 fixture 完全一致（`{"type":"system","subtype":"init",...}` → `{"type":"assistant",...}` → `{"type":"result","total_cost_usd":...,"usage":{...}}`）✓
- codex `--json`：JSONL 信封格式确认；实测错误事件为 `{"type":"error","message":...}` 与 `{"type":"turn.failed","error":{"message":...}}`；INFO 日志走 stderr，不污染 stdout JSONL ✓（`item.completed` 形状因后端 503 未能实测，按计划 fixture 实现）
- opencode：**支持 `--format json`**（优于计划假设的纯文本模式）→ Task 6 升级为 JSONL 解析。

**Step 4 — opencode 结构化输出：**
`--format json` 实测事件（JSONL）：
`{"type":"step_start",...}` / `{"type":"text","timestamp":...,"part":{"type":"text","text":"OK",...}}` / `{"type":"step_finish","part":{"reason":"stop","tokens":{"input":...,"output":...,"reasoning":...,"cache":{...}},"cost":0}}`

**Step 5 — stdin 传 prompt：**
- claude：`"say ok" | claude -p --output-format json` ✓（prompt 经 stdin 消费）
- codex：`"say ok" | codex exec - --json --skip-git-repo-check` ✓（`-` 占位符可用）
- opencode：`"say ok" | opencode run - --model ark/glm-5.2 --format json` ✓

**对后续任务的修正（以此为准）：**
1. Task 5 codex adapter：`buildCommand` 保留 `--skip-git-repo-check`（必需）；错误事件解析加 `j.message` fallback（`{"type":"error","message":...}` 无 `error` 字段）。
2. Task 6 opencode adapter：升级为 JSONL 解析（`--format json`），`text`→message、`step_finish`→done（usage=part.tokens.{input,output}，costUsd=part.cost），`buildCommand` args 追加 `--format json`。
3. Task 7 runner：stderr 行直接作为 system 事件发射（不要包一层 JSON 再走 parser，否则会被吞掉）。
4. opencode adapter `models` 建议列表改为：`ark/glm-5.2`、`opencode/deepseek-v4-flash-free`、`opencode/ling-3.0-flash-free`、`opencode/mimo-v2.5-free`。

### E2E 实测修正（Task 14 执行时补充）

1. **workdir 隔离**：runner 默认 workdir 从 `.arena/runs` 改为 `os.tmpdir()/model-agent-arena/runs`。实测 workdir 位于本项目 git 仓库内时，opencode 会向上定位 git 根并把产出文件写到项目根，破坏运行隔离；ADR-0001「裸跑临时目录」的本意即系统临时目录。
2. **opencode 工具事件**：真实信封为 `{"type":"tool_use","part":{"type":"tool","tool":"write","state":{"input":{"filePath":...}}}}`；write/edit/patch 工具额外派生 file_edit 事件（路径取 `part.state.input.filePath`）。
3. 首个真实对局验证：claude-code 因 Ark CodingPlan 订阅过期失败、codex 因后端 503 失败，均未阻塞 opencode 独立完成单文件贪吃蛇（302s），对局正确标记 `partial`，失败隔离（Task 14 Step 3）通过。
