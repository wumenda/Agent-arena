# Agent 竞技场 · UX 增强实施计划（ux-enhancements）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 补齐竞技场的「结果可见性」与「直播体验」：产出文件在线预览（HTML 沙箱试玩）、指标对比表格、双 Run 产出 diff、实时计时、轨迹自动滚动与事件展开、历史搜索过滤、对局报告导出、跨对局统计。

**Architecture:** 后端只加三个只读 API（文件读取/报告导出/统计聚合），核心逻辑全部下沉为可单测的纯函数（`files.ts` / `diff.ts` / `report.ts` / db 聚合函数）；前端以弹层（FileViewer / RunDiff）与页内区块（ComparisonTable）为主，不引入任何新依赖（LCS diff 手写约 40 行），UI 沿用现有暗色液态玻璃风格（`glass` / `glass-strong` / `glass-input` utility，见 `src/app/globals.css`）。

**Tech Stack:** 现有栈不变（Next.js 16 App Router + TypeScript + Tailwind + Drizzle/better-sqlite3 + vitest）。

**关键约束（勿偏离）：**
- 遵循项目 AGENTS.md：术语用「对局/运行（Run）/组合/轨迹/指标」；密钥不入库；纯逻辑必须有 vitest 单测；UI 只用 Tailwind；不引入计划外依赖。
- 产出文件读取必须防路径穿越（文件 API 只允许读 run workdir 内的文件）。
- 事件里的 `file_edit.path` 可能是绝对路径（claude-code 实测如此），点击预览前需在客户端用 `run.workdir` 相对化。
- 工作区当前有一批**未提交**的暗色玻璃 UI 改版，Task 0 先提交，避免与本计划混提交。
- Windows + PowerShell 5：所有命令在项目根执行；dev server 当前跑在 **http://localhost:3001**（3000 被占）。

---

## File Structure（最终形态）

```
src/
  lib/
    arena/
      files.ts                  # 新增：safeResolveFile / listRunFiles / readRunFile（纯逻辑，防穿越）
      diff.ts                   # 新增：LCS 行级 diff（纯逻辑）
      report.ts                 # 新增：buildMatchReport（纯逻辑，产出 markdown）
    db/
      index.ts                  # 修改：+ getComboStats() 聚合查询
  app/
    api/
      matches/[id]/file/route.ts     # 新增：?runId=x → 文件列表；&path=y → 文件内容
      matches/[id]/report/route.ts   # 新增：GET → text/markdown 附件下载
      stats/route.ts                 # 新增：GET → 跨对局组合统计
    match/[id]/page.tsx        # 修改：对比表 + 产出对比入口 + 导出报告 + 停轮询
    history/page.tsx           # 修改：搜索 + 状态/harness 过滤
    stats/page.tsx             # 新增：统计页
    layout.tsx                 # 修改：导航加「统计」
  components/
    FileViewer.tsx             # 新增：文件查看弹层（文本 + HTML 沙箱 iframe）
    RunDiff.tsx                # 新增：双 Run 同名文件 diff 弹层
    ComparisonTable.tsx        # 新增：指标对比表（可排序，最优高亮）
    DiffView.tsx               # 修改：文件名可点击 → FileViewer
    RunPanel.tsx               # 修改：传 matchId / startedAt / running
    MetricsBar.tsx             # 修改：running 实时走秒
    TrajectoryView.tsx         # 修改：自动滚动 + 事件点击展开
tests/
  arena/files.test.ts          # 新增
  arena/diff.test.ts           # 新增
  arena/report.test.ts         # 新增
  db/stats.test.ts             # 新增
```

任务依赖：Task 1（文件 API）是 Task 2（预览）与 Task 4（diff）的地基；Task 3（diff 库）在 Task 4 之前；其余任务相互独立。

---

### Task 0: 提交现有 UI 改版（清空工作区，避免混提交）

**Files:**
- 无新文件（提交工作区已有改动）

- [ ] **Step 1:** 确认工作区状态（应有一批前端文件 M + `.agents/skills/ui-ux-pro-max/` 未跟踪）：

```powershell
git status --short
```

- [ ] **Step 2:** 全量提交：

```powershell
git add -A; git commit -m "style: dark liquid glass UI restyle"
```

- [ ] **Step 3:** 验证工作区干净：`git status --short` 无输出。

---

### Task 1: 产出文件读取 API（列表 + 内容，防穿越）

**Files:**
- Create: `src/lib/arena/files.ts`、`src/app/api/matches/[id]/file/route.ts`
- Test: `tests/arena/files.test.ts`

- [ ] **Step 1:** 写失败测试 `tests/arena/files.test.ts`：

```ts
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
```

- [ ] **Step 2:** 运行确认失败（模块不存在）：

```powershell
npm test -- tests/arena/files.test.ts
```

预期：FAIL，Cannot find module `@/lib/arena/files`。

- [ ] **Step 3:** 创建 `src/lib/arena/files.ts`：

```ts
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

export const MAX_FILE_BYTES = 1024 * 1024; // 预览上限 1MB

// 安全解析：relPath 解析后必须位于 workdir 内（防路径穿越）；返回 null 表示非法
export function safeResolveFile(workdir: string, relPath: string): string | null {
  const wd = path.resolve(workdir);
  const resolved = path.resolve(wd, relPath);
  if (resolved !== wd && !resolved.startsWith(wd + path.sep)) return null;
  return resolved;
}

export type RunFileInfo = { path: string; size: number };

// 递归列出 run 产出文件（排除轨迹文件本身），相对路径统一用 /
export function listRunFiles(workdir: string): RunFileInfo[] {
  const out: RunFileInfo[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      const full = path.join(d, e.name);
      if (e.isDirectory()) walk(full);
      else {
        const rel = path.relative(workdir, full).split(path.sep).join("/");
        if (rel === "trajectory.jsonl") continue;
        out.push({ path: rel, size: statSync(full).size });
      }
    }
  };
  walk(workdir);
  return out.sort((a, b) => a.path.localeCompare(b.path));
}

// 读取文件内容（超 1MB 截断）
export function readRunFile(workdir: string, relPath: string): { content: string; truncated: boolean; size: number } | null {
  const resolved = safeResolveFile(workdir, relPath);
  if (!resolved) return null;
  const size = statSync(resolved).size;
  const content = readFileSync(resolved, "utf8").slice(0, MAX_FILE_BYTES);
  return { content, truncated: size > MAX_FILE_BYTES, size };
}
```

- [ ] **Step 4:** 运行测试通过：

```powershell
npm test -- tests/arena/files.test.ts
```

预期：PASS（7 个用例）。

- [ ] **Step 5:** 创建薄路由 `src/app/api/matches/[id]/file/route.ts`：

```ts
import { NextRequest, NextResponse } from "next/server";
import { getMatch, listRuns } from "@/lib/db";
import { listRunFiles, readRunFile } from "@/lib/arena/files";

// ?runId=x            → 产出文件列表
// ?runId=x&path=y     → 单个文件内容（仅 workdir 内，防穿越）
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const match = getMatch(id);
  if (!match) return NextResponse.json({ error: "not found" }, { status: 404 });
  const runId = req.nextUrl.searchParams.get("runId");
  const run = listRuns(id).find((r) => r.id === runId);
  if (!run) return NextResponse.json({ error: "run not found" }, { status: 404 });
  const filePath = req.nextUrl.searchParams.get("path");
  try {
    if (!filePath) return NextResponse.json({ files: listRunFiles(run.workdir) });
    const file = readRunFile(run.workdir, filePath);
    if (!file) return NextResponse.json({ error: "invalid path" }, { status: 400 });
    return NextResponse.json(file);
  } catch {
    return NextResponse.json({ error: "read failed" }, { status: 500 });
  }
}
```

- [ ] **Step 6:** 提交：

```powershell
git add -A; git commit -m "feat: run output file api with path traversal protection"
```

---

### Task 2: 产出文件在线预览（FileViewer + DiffView 可点击）

**Files:**
- Create: `src/components/FileViewer.tsx`
- Modify: `src/components/DiffView.tsx`（文件名改为可点击）、`src/components/RunPanel.tsx`（传 matchId）、`src/app/match/[id]/page.tsx`（RunPanel 传 matchId）

- [ ] **Step 1:** 创建 `src/components/FileViewer.tsx`：

```tsx
"use client";
import { useEffect, useState } from "react";

// 产出文件查看弹层：文本直接展示；HTML 用沙箱 iframe 预览（allow-scripts，无同源权限）
export default function FileViewer({ matchId, runId, filePath, onClose }: {
  matchId: string; runId: string; filePath: string; onClose: () => void;
}) {
  const [data, setData] = useState<{ content: string; truncated: boolean; size: number } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setData(null); setError("");
    fetch(`/api/matches/${matchId}/file?runId=${runId}&path=${encodeURIComponent(filePath)}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setData(d)))
      .catch(() => setError("加载失败"));
  }, [matchId, runId, filePath]);

  const isHtml = /\.html?$/i.test(filePath);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div className="glass-strong flex max-h-[85vh] w-full max-w-4xl flex-col rounded-3xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-4">
          <div className="truncate font-mono text-sm text-sky-300" title={filePath}>{filePath}</div>
          <button
            className="shrink-0 cursor-pointer rounded-full bg-white/10 px-3 py-1 text-xs text-white/70 hover:bg-white/20"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
        {error && <div className="mt-3 text-sm text-red-400">{error}</div>}
        {data?.truncated && <div className="mt-2 text-xs text-amber-300">文件超过 1MB，仅显示前 1MB</div>}
        {data && isHtml && (
          <iframe
            title={filePath}
            sandbox="allow-scripts"
            srcDoc={data.content}
            className="mt-3 h-[65vh] w-full rounded-2xl border border-white/10 bg-white"
          />
        )}
        {data && !isHtml && (
          <pre className="mt-3 max-h-[65vh] overflow-auto rounded-2xl border border-white/10 bg-black/40 p-3 font-mono text-xs whitespace-pre-wrap break-all text-white/80">
            {data.content}
          </pre>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2:** 重写 `src/components/DiffView.tsx`（文件可点击打开 FileViewer；绝对路径用 `run.workdir` 相对化——claude-code 的 file_edit 事件里是绝对路径，直接传会被防穿越拦截）：

```tsx
"use client";
import { useState } from "react";
import FileViewer from "./FileViewer";
import type { ArenaEvent } from "@/lib/arena/types";
import type { RunRow } from "@/lib/db/schema";

export default function DiffView({ events, matchId, run }: { events: ArenaEvent[]; matchId: string; run: RunRow }) {
  const [viewing, setViewing] = useState<string | null>(null);
  // 事件里的路径可能是绝对路径（在 workdir 内），转成相对路径再请求文件 API
  const relativize = (p: string) =>
    p.startsWith(run.workdir) ? p.slice(run.workdir.length).replace(/^[\\/]+/, "") : p;
  const files = [...new Set(events.filter((e) => e.kind === "file_edit").map((e) => relativize((e as { path: string }).path)))];
  const finalMessage = [...events].reverse().find((e) => e.kind === "message") as { text: string } | undefined;
  return (
    <div className="space-y-2">
      {files.length > 0 && (
        <div className="text-xs">
          <div className="font-medium tracking-wide text-white/40 uppercase">产出文件（点击查看）</div>
          {files.map((f) => (
            <button
              key={f}
              className="block max-w-full cursor-pointer truncate text-left font-mono text-sky-300 hover:text-sky-200 hover:underline"
              title={f}
              onClick={() => setViewing(f)}
            >
              {f}
            </button>
          ))}
        </div>
      )}
      {finalMessage && (
        <div className="glass-input rounded-2xl p-3 text-xs">
          <div className="font-medium tracking-wide text-white/40 uppercase">最终回答</div>
          <div className="mt-1 whitespace-pre-wrap text-white/80">{finalMessage.text}</div>
        </div>
      )}
      {viewing && (
        <FileViewer matchId={matchId} runId={run.id} filePath={viewing} onClose={() => setViewing(null)} />
      )}
    </div>
  );
}
```

- [ ] **Step 3:** 修改 `src/components/RunPanel.tsx`：接收 `matchId` 并传给 DiffView。签名与 DiffView 行改为：

```tsx
export default function RunPanel({ run, events, matchId }: { run: RunRow; events: ArenaEvent[]; matchId: string }) {
```

```tsx
      {(run.status === "completed" || run.status === "timeout") && <DiffView events={events} matchId={matchId} run={run} />}
```

- [ ] **Step 4:** 修改 `src/app/match/[id]/page.tsx`：RunPanel 调用处传 `matchId`：

```tsx
        {runs.map((r) => (
          <RunPanel key={r.id} run={r} events={events[r.id] ?? []} matchId={id} />
        ))}
```

- [ ] **Step 5:** 运行 `npm test` 确认全绿（18 个既有用例不受影响）。

- [ ] **Step 6:** 手工冒烟：dev server（http://localhost:3001）打开历史里已完成对局（如 kq8pkgmx7j / lb2tjycvrs，以 `/api/matches` 实际列表为准）→ 「产出文件」下的 `hello.txt` 可点击 → 弹层展示内容。

- [ ] **Step 7:** 提交：

```powershell
git add -A; git commit -m "feat: file viewer with sandboxed html preview for run outputs"
```

---

### Task 3: LCS 行级 diff 纯函数

**Files:**
- Create: `src/lib/arena/diff.ts`
- Test: `tests/arena/diff.test.ts`

- [ ] **Step 1:** 写失败测试 `tests/arena/diff.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { diffLines } from "@/lib/arena/diff";

describe("diffLines", () => {
  it("returns all same for identical lines", () => {
    const d = diffLines(["a", "b"], ["a", "b"]);
    expect(d.every((l) => l.type === "same")).toBe(true);
    expect(d).toHaveLength(2);
  });
  it("marks deleted and added lines", () => {
    const d = diffLines(["a", "b"], ["a", "c"]);
    expect(d).toEqual([
      { type: "same", text: "a" },
      { type: "del", text: "b" },
      { type: "add", text: "c" },
    ]);
  });
  it("handles empty inputs", () => {
    expect(diffLines([], ["x"])).toEqual([{ type: "add", text: "x" }]);
    expect(diffLines(["x"], [])).toEqual([{ type: "del", text: "x" }]);
  });
  it("keeps longest common subsequence order", () => {
    const d = diffLines(["1", "2", "3"], ["2", "3", "4"]);
    expect(d.filter((l) => l.type === "same").map((l) => l.text)).toEqual(["2", "3"]);
  });
});
```

- [ ] **Step 2:** 运行确认失败：`npm test -- tests/arena/diff.test.ts`（模块不存在）。

- [ ] **Step 3:** 创建 `src/lib/arena/diff.ts`：

```ts
export type DiffLine = { type: "same" | "add" | "del"; text: string };

const MAX_LINES = 1500; // LCS 是 O(n·m)，超出直接按全变更处理

// 行级 diff（LCS）：a 为旧版（删除侧），b 为新版（新增侧）
export function diffLines(a: string[], b: string[]): DiffLine[] {
  if (a.length > MAX_LINES || b.length > MAX_LINES) {
    return [
      ...a.map((text) => ({ type: "del" as const, text })),
      ...b.map((text) => ({ type: "add" as const, text })),
    ];
  }
  const n = a.length, m = b.length;
  // dp[i][j] = a[i..] 与 b[j..] 的 LCS 长度
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push({ type: "same", text: a[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ type: "del", text: a[i] }); i++; }
    else { out.push({ type: "add", text: b[j] }); j++; }
  }
  while (i < n) { out.push({ type: "del", text: a[i] }); i++; }
  while (j < m) { out.push({ type: "add", text: b[j] }); j++; }
  return out;
}
```

- [ ] **Step 4:** 运行测试通过：`npm test -- tests/arena/diff.test.ts`。

- [ ] **Step 5:** 提交：

```powershell
git add -A; git commit -m "feat: lcs line diff for output comparison"
```

---

### Task 4: 双 Run 产出对比（RunDiff 弹层）

**Files:**
- Create: `src/components/RunDiff.tsx`
- Modify: `src/app/match/[id]/page.tsx`（入口按钮 + 弹层挂载）

- [ ] **Step 1:** 创建 `src/components/RunDiff.tsx`：

```tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import { diffLines, type DiffLine } from "@/lib/arena/diff";
import type { RunRow } from "@/lib/db/schema";

// 双 Run 产出对比：选两个 Run + 同名产出文件，行级 diff（红=A 删除，绿=B 新增）
export default function RunDiff({ matchId, runs, onClose }: {
  matchId: string; runs: RunRow[]; onClose: () => void;
}) {
  const [runA, setRunA] = useState(runs[0]?.id ?? "");
  const [runB, setRunB] = useState(runs[1]?.id ?? runs[0]?.id ?? "");
  const [filesA, setFilesA] = useState<string[]>([]);
  const [filesB, setFilesB] = useState<string[]>([]);
  const [file, setFile] = useState("");
  const [contentA, setContentA] = useState<string | null>(null);
  const [contentB, setContentB] = useState<string | null>(null);

  const label = (id: string) => {
    const r = runs.find((x) => x.id === id);
    return r ? `${r.harness} · ${r.model}` : id;
  };

  useEffect(() => {
    if (!runA || !runB) return;
    setFile(""); setContentA(null); setContentB(null);
    Promise.all([
      fetch(`/api/matches/${matchId}/file?runId=${runA}`).then((r) => r.json()),
      fetch(`/api/matches/${matchId}/file?runId=${runB}`).then((r) => r.json()),
    ]).then(([a, b]) => {
      setFilesA(a.files?.map((f: { path: string }) => f.path) ?? []);
      setFilesB(b.files?.map((f: { path: string }) => f.path) ?? []);
    });
  }, [matchId, runA, runB]);

  const common = useMemo(() => filesA.filter((f) => filesB.includes(f)), [filesA, filesB]);

  useEffect(() => {
    if (!file || !runA || !runB) return;
    Promise.all([
      fetch(`/api/matches/${matchId}/file?runId=${runA}&path=${encodeURIComponent(file)}`).then((r) => r.json()),
      fetch(`/api/matches/${matchId}/file?runId=${runB}&path=${encodeURIComponent(file)}`).then((r) => r.json()),
    ]).then(([a, b]) => {
      setContentA(a.content ?? "");
      setContentB(b.content ?? "");
    });
  }, [matchId, runA, runB, file]);

  const diff: DiffLine[] | null = useMemo(
    () => contentA != null && contentB != null
      ? diffLines(contentA.split("\n"), contentB.split("\n"))
      : null,
    [contentA, contentB]
  );

  const sel = "glass-input cursor-pointer rounded-full px-3 py-1.5 text-xs text-white/85 outline-none";
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div className="glass-strong flex max-h-[85vh] w-full max-w-5xl flex-col rounded-3xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-4">
          <div className="text-sm font-semibold text-white/90">产出对比</div>
          <button className="shrink-0 cursor-pointer rounded-full bg-white/10 px-3 py-1 text-xs text-white/70 hover:bg-white/20" onClick={onClose}>关闭</button>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <select className={sel} value={runA} onChange={(e) => setRunA(e.target.value)}>
            {runs.map((r) => <option key={r.id} value={r.id}>A：{label(r.id)}</option>)}
          </select>
          <span className="text-white/30">vs</span>
          <select className={sel} value={runB} onChange={(e) => setRunB(e.target.value)}>
            {runs.map((r) => <option key={r.id} value={r.id}>B：{label(r.id)}</option>)}
          </select>
          <select className={sel} value={file} onChange={(e) => setFile(e.target.value)} disabled={common.length === 0}>
            <option value="">{common.length === 0 ? "无同名产出文件" : "选择文件…"}</option>
            {common.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
        </div>
        {diff && (
          <div className="mt-2 text-[10px] text-white/40">
            <span className="text-red-300">− {label(runA)}</span>
            <span className="mx-2">·</span>
            <span className="text-emerald-300">+ {label(runB)}</span>
          </div>
        )}
        {diff && (
          <div className="mt-2 max-h-[60vh] overflow-auto rounded-2xl border border-white/10 bg-black/40 p-3 font-mono text-xs">
            {diff.map((l, i) => (
              <div key={i} className={
                l.type === "add" ? "bg-emerald-400/10 text-emerald-300" :
                l.type === "del" ? "bg-red-400/10 text-red-300" : "text-white/40"
              }>
                <span className="mr-2 inline-block w-3 select-none">{l.type === "add" ? "+" : l.type === "del" ? "−" : " "}</span>
                <span className="whitespace-pre-wrap break-all">{l.text || " "}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
```

- [ ] **Step 2:** 修改 `src/app/match/[id]/page.tsx`：

顶部 import 增加：

```tsx
import RunDiff from "@/components/RunDiff";
```

组件内新增状态：

```tsx
  const [showDiff, setShowDiff] = useState(false);
```

把现有头部按钮区（单个「一键重跑」按钮外包一层容器，并加入「产出对比」按钮）：

```tsx
        <div className="flex shrink-0 items-center gap-2">
          <button
            className="glass cursor-pointer rounded-full px-4 py-1.5 text-sm text-white/70 transition-colors duration-200 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            disabled={runs.length < 2}
            onClick={() => setShowDiff(true)}
          >
            产出对比
          </button>
          <button
            className="glass shrink-0 cursor-pointer rounded-full px-4 py-1.5 text-sm text-white/70 transition-colors duration-200 hover:bg-white/10 hover:text-white"
            onClick={rerun}
          >
            一键重跑（看方差）
          </button>
        </div>
```

（替换原来单个 rerun button 的 `<button ...>一键重跑（看方差）</button>`；外层 `flex items-center justify-between` 的头保持不变。）

`</main>` 前挂载弹层：

```tsx
      {showDiff && <RunDiff matchId={id} runs={runs} onClose={() => setShowDiff(false)} />}
```

- [ ] **Step 3:** 运行 `npm test` 全绿。

- [ ] **Step 4:** 手工冒烟：打开已完成对局（含 ≥2 个 run）→ 点「产出对比」→ 选 A/B 与 `hello.txt` → 出现红绿 diff。

- [ ] **Step 5:** 提交：

```powershell
git add -A; git commit -m "feat: run-to-run output diff modal"
```

---

### Task 5: 指标对比表格（可排序 + 最优高亮）

**Files:**
- Create: `src/components/ComparisonTable.tsx`
- Modify: `src/app/match/[id]/page.tsx`

- [ ] **Step 1:** 创建 `src/components/ComparisonTable.tsx`：

```tsx
"use client";
import { useMemo, useState } from "react";
import type { RunRow } from "@/lib/db/schema";

type SortKey = "duration" | "tokensIn" | "tokensOut" | "cost";

const fmt = (ms: number) => ms > 60000 ? `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s` : `${(ms / 1000).toFixed(1)}s`;

// 对局结束后的指标汇总表：列可排序，completed 中的最优值（越低越好）高亮
export default function ComparisonTable({ runs }: { runs: RunRow[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("duration");
  const [asc, setAsc] = useState(true);

  const get = (r: RunRow) =>
    (sortKey === "duration" ? r.durationMs : sortKey === "cost" ? r.costUsd : sortKey === "tokensIn" ? r.tokensIn : r.tokensOut)
    ?? Number.POSITIVE_INFINITY;

  const sorted = useMemo(
    () => [...runs].sort((x, y) => (asc ? get(x) - get(y) : get(y) - get(x))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runs, sortKey, asc]
  );

  const best = useMemo(() => {
    const done = runs.filter((r) => r.status === "completed");
    const min = (f: (r: RunRow) => number | null) => {
      const vals = done.map(f).filter((v): v is number => v != null);
      return vals.length ? Math.min(...vals) : null;
    };
    return {
      duration: min((r) => r.durationMs),
      cost: min((r) => r.costUsd),
      tokensIn: min((r) => r.tokensIn),
      tokensOut: min((r) => r.tokensOut),
    };
  }, [runs]);

  const isBest = (v: number | null | undefined, b: number | null) => v != null && b != null && v === b;

  const th = (key: SortKey, label: string) => (
    <th
      className="cursor-pointer px-3 py-2 text-right font-medium whitespace-nowrap select-none hover:text-white"
      onClick={() => { if (sortKey === key) setAsc(!asc); else { setSortKey(key); setAsc(true); } }}
    >
      {label}{sortKey === key ? (asc ? " ↑" : " ↓") : ""}
    </th>
  );

  return (
    <div className="glass-strong overflow-x-auto rounded-3xl p-4">
      <table className="w-full text-xs">
        <thead>
          <tr className="text-white/40">
            <th className="px-3 py-2 text-left font-medium">组合</th>
            <th className="px-3 py-2 text-left font-medium">状态</th>
            {th("duration", "耗时")}
            {th("tokensIn", "tokens in")}
            {th("tokensOut", "tokens out")}
            {th("cost", "成本")}
          </tr>
        </thead>
        <tbody className="font-mono">
          {sorted.map((r) => (
            <tr key={r.id} className="border-t border-white/5">
              <td className="px-3 py-2 font-sans whitespace-nowrap text-white/85">{r.harness} · {r.model}</td>
              <td className="px-3 py-2 font-sans text-white/50">{r.status}</td>
              <td className={`px-3 py-2 text-right whitespace-nowrap ${isBest(r.durationMs, best.duration) ? "text-emerald-300" : "text-white/60"}`}>
                {r.durationMs != null ? fmt(r.durationMs) : "—"}
              </td>
              <td className={`px-3 py-2 text-right ${isBest(r.tokensIn, best.tokensIn) ? "text-emerald-300" : "text-white/60"}`}>{r.tokensIn ?? "—"}</td>
              <td className={`px-3 py-2 text-right ${isBest(r.tokensOut, best.tokensOut) ? "text-emerald-300" : "text-white/60"}`}>{r.tokensOut ?? "—"}</td>
              <td className={`px-3 py-2 text-right whitespace-nowrap ${isBest(r.costUsd, best.cost) ? "text-emerald-300" : "text-white/60"}`}>
                {r.costUsd != null ? `$${r.costUsd.toFixed(4)}` : "n/a"}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 2:** 修改 `src/app/match/[id]/page.tsx`：import 增加 `ComparisonTable`；在头部区块（`</div>` 结束的 header flex 容器）之后、`<div className="flex gap-4 overflow-x-auto pb-2">` 之前插入：

```tsx
      {["completed", "partial"].includes(matchStatus) && runs.length > 0 && <ComparisonTable runs={runs} />}
```

- [ ] **Step 3:** 运行 `npm test` 全绿。

- [ ] **Step 4:** 手工冒烟：打开已完成对局 → 顶部出现汇总表 → 点「耗时」「成本」列头排序切换 → completed 中最优值绿色高亮。

- [ ] **Step 5:** 提交：

```powershell
git add -A; git commit -m "feat: sortable metrics comparison table with best-value highlight"
```

---

### Task 6: 运行中实时计时 + 结束后停止轮询

**Files:**
- Modify: `src/components/MetricsBar.tsx`、`src/components/RunPanel.tsx`、`src/app/match/[id]/page.tsx`

- [ ] **Step 1:** 修改 `src/components/MetricsBar.tsx`：增加 `startedAt` / `running` props，running 时按秒实时走表：

```tsx
"use client";
import { useEffect, useState } from "react";

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" className="size-3.5 opacity-60" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export default function MetricsBar({
  durationMs, tokensIn, tokensOut, costUsd, startedAt, running,
}: { durationMs: number | null; tokensIn: number | null; tokensOut: number | null; costUsd: number | null;
     startedAt?: string | null; running?: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running || !startedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running, startedAt]);
  const liveMs = running && startedAt ? now - new Date(startedAt).getTime() : null;
  const shown = liveMs ?? durationMs;
  const fmt = (ms: number) => ms > 60000 ? `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s` : `${(ms / 1000).toFixed(1)}s`;
  return (
    <div className="glass flex items-center justify-between gap-2 rounded-full px-3 py-1.5 font-mono text-xs text-white/60">
      <span className={`flex items-center gap-1.5 ${running ? "text-sky-300" : ""}`} title="耗时">
        <Icon d="M12 6v6l4 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z" />
        {shown != null ? fmt(shown) : "—"}
      </span>
      <span className="flex items-center gap-1.5" title="tokens 输入 → 输出">
        <Icon d="m17 11-5-5-5 5M17 18l-5 5-5-5" />
        {tokensIn != null ? `${tokensIn} → ${tokensOut}` : "n/a"}
      </span>
      <span className="flex items-center gap-1.5" title="成本（美元）">
        <Icon d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        {costUsd != null ? `$${costUsd.toFixed(4)}` : "n/a"}
      </span>
    </div>
  );
}
```

- [ ] **Step 2:** 修改 `src/components/RunPanel.tsx` 的 MetricsBar 调用：

```tsx
      <MetricsBar durationMs={run.durationMs} tokensIn={run.tokensIn} tokensOut={run.tokensOut} costUsd={run.costUsd}
        startedAt={run.startedAt} running={run.status === "running"} />
```

- [ ] **Step 3:** 修改 `src/app/match/[id]/page.tsx`：对局进入终态后停止 5s 轮询。在 `useEffect` 内加 `doneRef`：

```tsx
  useEffect(() => {
    const doneRef = { current: false };
    const load = async () => {
      const res = await fetch(`/api/matches/${id}`);
      if (res.ok) {
        const { match, runs } = await res.json();
        setRuns(runs);
        setMatchStatus(match.status);
        if (["completed", "partial"].includes(match.status)) doneRef.current = true;
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
    const poll = setInterval(() => { if (!doneRef.current) load(); }, 5000);
    const es = new EventSource(`/api/matches/${id}/stream`);
    es.onmessage = (m) => {
      const e = JSON.parse(m.data);
      if (e.channel === "run-event") {
        setEvents((prev) => ({ ...prev, [e.runId]: [...(prev[e.runId] ?? []), e.event] }));
      } else if (e.channel === "run-status") {
        setRuns((prev) => prev.map((r) => (r.id === e.runId ? { ...r, status: e.status, error: e.error ?? r.error } : r)));
      } else if (e.channel === "match-status") {
        setMatchStatus(e.status);
        if (["completed", "partial"].includes(e.status)) doneRef.current = true;
      }
    };
    return () => { clearInterval(poll); es.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);
```

（整段替换原 `useEffect`；`events` 闭包与原实现保持一致。）

- [ ] **Step 4:** 运行 `npm test` 全绿。

- [ ] **Step 5:** 手工冒烟：新建一个轻量对局（如 prompt「say ok」，opencode/ark/glm-5.2 单组合）→ 直播页耗时处实时走秒（天蓝色）→ 结束后固定为终值，Network 面板轮询停止。

- [ ] **Step 6:** 提交：

```powershell
git add -A; git commit -m "feat: live elapsed timer and stop polling on match completion"
```

---

### Task 7: 轨迹自动滚动 + 事件详情展开

**Files:**
- Modify: `src/components/TrajectoryView.tsx`（整体重写）

- [ ] **Step 1:** 重写 `src/components/TrajectoryView.tsx`：

```tsx
"use client";
import { useEffect, useRef, useState } from "react";
import type { ArenaEvent } from "@/lib/arena/types";

function eventSummary(e: ArenaEvent): string {
  return e.kind === "message" ? e.text :
    e.kind === "thinking" ? `思考：${e.text.slice(0, 200)}` :
    e.kind === "tool_call" ? `调用工具 ${e.tool}` :
    e.kind === "tool_result" ? `工具返回：${e.output.slice(0, 200)}` :
    e.kind === "file_edit" ? `编辑文件 ${e.path}` :
    e.kind === "command" ? `执行命令 ${e.command}（退出码 ${e.exitCode ?? "?"}）` :
    e.kind === "system" ? `[系统] ${e.text.slice(0, 200)}` :
    e.kind === "error" ? `错误：${e.text.slice(0, 200)}` : "完成";
}

function eventFull(e: ArenaEvent): string {
  switch (e.kind) {
    case "message": return e.text;
    case "thinking": return e.text;
    case "tool_call": return `${e.tool}\n${JSON.stringify(e.input, null, 2)}`;
    case "tool_result": return e.output;
    case "file_edit": return e.path;
    case "command": return `${e.command}${e.output ? `\n${e.output}` : ""}`;
    case "system": return e.text;
    case "error": return e.text;
    case "done": return e.usage ? `tokens: ${e.usage.input} → ${e.usage.output}${e.costUsd != null ? `\ncost: $${e.costUsd}` : ""}` : "完成";
  }
}

function eventColor(e: ArenaEvent): string {
  return e.kind === "message" ? "text-white/85" :
    e.kind === "thinking" ? "text-violet-300" :
    e.kind === "tool_call" || e.kind === "file_edit" ? "text-sky-300" :
    e.kind === "tool_result" || e.kind === "command" ? "text-white/45" :
    e.kind === "error" ? "text-red-300" : "text-white/30";
}

function EventRow({ e }: { e: ArenaEvent }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        className={`${eventColor(e)} w-full cursor-pointer truncate text-left font-mono text-xs leading-5`}
        title="点击展开详情"
        onClick={() => setOpen(!open)}
      >
        {eventSummary(e)}
      </button>
      {open && (
        <div className="max-h-48 overflow-auto rounded-xl border border-white/10 bg-black/40 p-2 font-mono text-xs break-all whitespace-pre-wrap text-white/70">
          {eventFull(e)}
        </div>
      )}
    </div>
  );
}

// 轨迹时间线：事件流入时自动滚动到底部；用户上滚即暂停跟随，可一键回到最新
export default function TrajectoryView({ events }: { events: ArenaEvent[] }) {
  const boxRef = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);

  useEffect(() => {
    if (follow && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [events.length, follow]);

  const onScroll = () => {
    const el = boxRef.current;
    if (!el) return;
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
  };

  return (
    <div className="relative">
      <div
        ref={boxRef}
        onScroll={onScroll}
        className="h-48 space-y-0.5 overflow-y-auto rounded-2xl border border-white/10 bg-black/40 p-2.5 shadow-inner"
      >
        {events.length === 0 && <div className="text-xs text-white/30">等待事件…</div>}
        {events.map((e, i) => <EventRow key={i} e={e} />)}
      </div>
      {!follow && (
        <button
          onClick={() => { setFollow(true); if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight; }}
          className="absolute right-3 bottom-3 cursor-pointer rounded-full bg-sky-500/80 px-2.5 py-1 text-[10px] font-medium text-white shadow-lg shadow-sky-500/25"
        >
          ↓ 回到最新
        </button>
      )}
    </div>
  );
}
```

- [ ] **Step 2:** 运行 `npm test` 全绿。

- [ ] **Step 3:** 手工冒烟：直播页观察轨迹随事件自动下滚；向上滚动出现「↓ 回到最新」按钮；点击任意事件行展开完整内容（tool_call 展开为工具名 + JSON input）。

- [ ] **Step 4:** 提交：

```powershell
git add -A; git commit -m "feat: trajectory auto-scroll with follow toggle and event detail expansion"
```

---

### Task 8: 历史页搜索与过滤

**Files:**
- Modify: `src/app/history/page.tsx`

- [ ] **Step 1:** 重写 `src/app/history/page.tsx`（关键字 + 状态 + harness 三重过滤，纯客户端）：

```tsx
"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";

type MatchRow = { id: string; prompt: string; combos: string; status: string; createdAt: string };

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-white/10 text-white/60",
  running: "bg-sky-400/15 text-sky-300",
  completed: "bg-emerald-400/15 text-emerald-300",
  failed: "bg-red-400/15 text-red-300",
  timeout: "bg-amber-400/15 text-amber-300",
};

export default function HistoryPage() {
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [harness, setHarness] = useState("all");

  useEffect(() => {
    fetch("/api/matches").then((r) => r.json()).then((d) => setMatches(d.matches ?? []));
  }, []);

  const harnessOptions = useMemo(
    () => [...new Set(matches.flatMap((m) => JSON.parse(m.combos).map((c: { harness: string }) => c.harness)))].sort(),
    [matches]
  );

  const filtered = useMemo(() => matches.filter((m) =>
    (status === "all" || m.status === status) &&
    (harness === "all" || JSON.parse(m.combos).some((c: { harness: string }) => c.harness === harness)) &&
    (q === "" || m.prompt.toLowerCase().includes(q.toLowerCase()) || m.id.includes(q))
  ), [matches, q, status, harness]);

  const sel = "glass-input cursor-pointer rounded-full px-3 py-1.5 text-xs text-white/85 outline-none";

  return (
    <main className="mx-auto w-full max-w-4xl space-y-4 p-8">
      <h1 className="text-2xl font-bold tracking-tight text-white/90">历史对局</h1>
      <div className="glass flex flex-wrap items-center gap-2 rounded-full p-2">
        <input
          className="glass-input min-w-40 flex-1 rounded-full px-3 py-1.5 text-xs text-white/85 outline-none placeholder-white/30"
          placeholder="搜索 prompt 或对局 id…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className={sel} value={status} onChange={(e) => setStatus(e.target.value)}>
          <option value="all">全部状态</option>
          {["pending", "running", "completed", "partial"].map((s) => <option key={s} value={s}>{s}</option>)}
        </select>
        <select className={sel} value={harness} onChange={(e) => setHarness(e.target.value)}>
          <option value="all">全部 harness</option>
          {harnessOptions.map((h) => <option key={h} value={h}>{h}</option>)}
        </select>
        <span className="px-2 text-xs whitespace-nowrap text-white/40">{filtered.length} / {matches.length}</span>
      </div>
      {filtered.length === 0 && (
        <div className="glass rounded-3xl p-8 text-center text-sm text-white/40">
          {matches.length === 0 ? "还没有对局" : "没有匹配的对局"}
        </div>
      )}
      <div className="space-y-3">
        {filtered.map((m) => (
          <Link
            key={m.id}
            href={`/match/${m.id}`}
            className="glass block cursor-pointer rounded-3xl p-4 transition-colors duration-200 hover:bg-white/10"
          >
            <div className="flex items-center gap-2 font-mono text-xs text-white/35">
              <span className="truncate">{m.id}</span>
              <span className={`shrink-0 rounded-full px-2 py-0.5 ${STATUS_STYLE[m.status] ?? "bg-white/10 text-white/60"}`}>
                {m.status}
              </span>
              <span className="shrink-0">{new Date(m.createdAt).toLocaleString()}</span>
            </div>
            <div className="mt-1.5 truncate text-sm text-white/85">{m.prompt}</div>
            <div className="mt-1 text-xs text-white/40">
              {JSON.parse(m.combos).map((c: { harness: string; model: string }) => `${c.harness}×${c.model}`).join("，")}
            </div>
          </Link>
        ))}
      </div>
    </main>
  );
}
```

- [ ] **Step 2:** 手工冒烟：历史页输入关键字（如「贪吃蛇」）→ 列表实时过滤；切换状态/harness 下拉 → 过滤生效；计数显示 `x / y`。

- [ ] **Step 3:** 运行 `npm test` 全绿；提交：

```powershell
git add -A; git commit -m "feat: history page search and filter"
```

---

### Task 9: 对局报告导出（Markdown）

**Files:**
- Create: `src/lib/arena/report.ts`、`src/app/api/matches/[id]/report/route.ts`
- Test: `tests/arena/report.test.ts`
- Modify: `src/app/match/[id]/page.tsx`（导出按钮）

- [ ] **Step 1:** 写失败测试 `tests/arena/report.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { buildMatchReport } from "@/lib/arena/report";
import type { MatchRow, RunRow } from "@/lib/db/schema";

const match: MatchRow = {
  id: "m1", prompt: "写一个贪吃蛇", combos: "[]", status: "completed",
  createdAt: new Date("2026-09-12T00:00:00Z"),
};
const run: RunRow = {
  id: "r1", matchId: "m1", harness: "claude-code", model: "glm-5.3-flash",
  status: "completed", error: null, workdir: "/tmp/x", startedAt: null, finishedAt: null,
  durationMs: 61000, tokensIn: 100, tokensOut: 20, costUsd: 0.05,
};
const events = [
  { kind: "tool_call", tool: "Write", input: {}, ts: 1 },
  { kind: "file_edit", path: "snake.html", ts: 2 },
  { kind: "message", text: "完成", ts: 3 },
] as never;

describe("buildMatchReport", () => {
  it("renders header, metrics table and per-run sections", () => {
    const md = buildMatchReport(match, [run], { r1: events });
    expect(md).toContain("# 对局报告 m1");
    expect(md).toContain("写一个贪吃蛇");
    expect(md).toContain("claude-code×glm-5.3-flash");
    expect(md).toContain("1m1s"); // 61000ms
    expect(md).toContain("100→20");
    expect(md).toContain("$0.0500");
    expect(md).toContain("snake.html");
    expect(md).toContain("完成");
  });
});
```

- [ ] **Step 2:** 运行确认失败：`npm test -- tests/arena/report.test.ts`（模块不存在）。

- [ ] **Step 3:** 创建 `src/lib/arena/report.ts`：

```ts
import type { MatchRow, RunRow } from "@/lib/db/schema";
import type { ArenaEvent } from "./types";

const fmt = (ms: number | null) =>
  ms == null ? "n/a" : ms > 60000 ? `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s` : `${(ms / 1000).toFixed(1)}s`;

const fileEditPaths = (evs: ArenaEvent[]) =>
  [...new Set(evs.filter((e) => e.kind === "file_edit").map((e) => (e as { path: string }).path))];

// 对局报告（markdown）：指标汇总表 + 每个 Run 的产出文件与最终回答
export function buildMatchReport(match: MatchRow, runs: RunRow[], eventsByRun: Record<string, ArenaEvent[]>): string {
  const lines: string[] = [];
  lines.push(`# 对局报告 ${match.id}`);
  lines.push("");
  lines.push(`- **任务**：${match.prompt}`);
  lines.push(`- **时间**：${new Date(match.createdAt).toLocaleString()}`);
  lines.push(`- **状态**：${match.status}`);
  lines.push("");
  lines.push(`## 指标对比`);
  lines.push("");
  lines.push(`| 组合 | 状态 | 耗时 | tokens in→out | 成本 | 工具调用 | 产出文件 |`);
  lines.push(`|---|---|---|---|---|---|---|`);
  for (const r of runs) {
    const evs = eventsByRun[r.id] ?? [];
    const toolCalls = evs.filter((e) => e.kind === "tool_call").length;
    lines.push(
      `| ${r.harness}×${r.model} | ${r.status} | ${fmt(r.durationMs)} | ` +
      `${r.tokensIn != null ? `${r.tokensIn}→${r.tokensOut}` : "n/a"} | ` +
      `${r.costUsd != null ? `$${r.costUsd.toFixed(4)}` : "n/a"} | ${toolCalls} | ${fileEditPaths(evs).length} |`
    );
  }
  for (const r of runs) {
    lines.push("");
    lines.push(`## ${r.harness}×${r.model}`);
    const evs = eventsByRun[r.id] ?? [];
    const files = fileEditPaths(evs);
    if (files.length) lines.push(`- 产出文件：${files.join("、")}`);
    const lastMsg = [...evs].reverse().find((e) => e.kind === "message") as { text: string } | undefined;
    if (lastMsg) {
      lines.push(`- 最终回答：`);
      lines.push("");
      lines.push("```");
      lines.push(lastMsg.text.slice(0, 2000));
      lines.push("```");
    }
    if (r.error) lines.push(`- 错误：${r.error}`);
  }
  return lines.join("\n");
}
```

- [ ] **Step 4:** 运行测试通过：`npm test -- tests/arena/report.test.ts`。

- [ ] **Step 5:** 创建 `src/app/api/matches/[id]/report/route.ts`：

```ts
import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "node:fs";
import path from "node:path";
import { getMatch, listRuns } from "@/lib/db";
import { buildMatchReport } from "@/lib/arena/report";
import type { ArenaEvent } from "@/lib/arena/types";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const match = getMatch(id);
  if (!match) return NextResponse.json({ error: "not found" }, { status: 404 });
  const runs = listRuns(id);
  const eventsByRun: Record<string, ArenaEvent[]> = {};
  for (const run of runs) {
    try {
      const traj = readFileSync(path.join(run.workdir, "trajectory.jsonl"), "utf8");
      eventsByRun[run.id] = traj.split("\n").filter(Boolean).map((l) => JSON.parse(l));
    } catch {
      eventsByRun[run.id] = [];
    }
  }
  const md = buildMatchReport(match, runs, eventsByRun);
  return new NextResponse(md, {
    headers: {
      "Content-Type": "text/markdown; charset=utf-8",
      "Content-Disposition": `attachment; filename="match-${id}.md"`,
    },
  });
}
```

- [ ] **Step 6:** 修改 `src/app/match/[id]/page.tsx`：在头部按钮组（Task 4 加入的「产出对比」按钮之前）加导出链接：

```tsx
          <a
            className="glass cursor-pointer rounded-full px-4 py-1.5 text-sm text-white/70 transition-colors duration-200 hover:bg-white/10 hover:text-white"
            href={`/api/matches/${id}/report`}
          >
            导出报告
          </a>
```

- [ ] **Step 7:** 手工冒烟：打开已完成对局 → 点「导出报告」→ 浏览器下载 `match-<id>.md`，内容含指标表与各 Run 最终回答。

- [ ] **Step 8:** 提交：

```powershell
git add -A; git commit -m "feat: markdown match report export"
```

---

### Task 10: 跨对局组合统计

**Files:**
- Create: `src/app/api/stats/route.ts`、`src/app/stats/page.tsx`
- Modify: `src/lib/db/index.ts`（+ getComboStats）、`src/app/layout.tsx`（导航）
- Test: `tests/db/stats.test.ts`

- [ ] **Step 1:** 写失败测试 `tests/db/stats.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { createRun, updateRun, getComboStats } from "@/lib/db/index";

describe("getComboStats", () => {
  it("aggregates per harness×model", () => {
    createRun({ id: "st1", matchId: "stm", harness: "claude-code", model: "glm-5.3-flash", workdir: "/tmp/a" });
    createRun({ id: "st2", matchId: "stm", harness: "claude-code", model: "glm-5.3-flash", workdir: "/tmp/b" });
    createRun({ id: "st3", matchId: "stm", harness: "codex", model: "glm-5.2", workdir: "/tmp/c" });
    updateRun("st1", { status: "completed", durationMs: 1000, tokensIn: 10, tokensOut: 5, costUsd: 0.1 });
    updateRun("st2", { status: "failed", durationMs: 3000 });
    updateRun("st3", { status: "completed", durationMs: 2000, costUsd: 0.2 });

    const stats = getComboStats();
    const cc = stats.find((s) => s.harness === "claude-code" && s.model === "glm-5.3-flash")!;
    expect(cc.total).toBe(2);
    expect(cc.completed).toBe(1);
    expect(cc.avgDurationMs).toBe(2000); // (1000+3000)/2
    const cx = stats.find((s) => s.harness === "codex")!;
    expect(cx.total).toBe(1);
    expect(cx.avgCostUsd).toBeCloseTo(0.2);
  });
});
```

- [ ] **Step 2:** 运行确认失败：`npm test -- tests/db/stats.test.ts`（getComboStats 不存在）。

- [ ] **Step 3:** 在 `src/lib/db/index.ts` 底部追加（同时顶部 import 增加 `sql`）：

```ts
import { eq, desc, sql } from "drizzle-orm";
```

```ts
// 跨对局统计：按 harness×model 聚合（排除未开始的 run）
export function getComboStats() {
  const rows = db.select({
    harness: runs.harness,
    model: runs.model,
    total: sql<number>`COUNT(*)`,
    completed: sql<number>`SUM(CASE WHEN ${runs.status} = 'completed' THEN 1 ELSE 0 END)`,
    avgDurationMs: sql<number | null>`AVG(${runs.durationMs})`,
    avgTokensIn: sql<number | null>`AVG(${runs.tokensIn})`,
    avgTokensOut: sql<number | null>`AVG(${runs.tokensOut})`,
    avgCostUsd: sql<number | null>`AVG(${runs.costUsd})`,
  }).from(runs).where(sql`${runs.status} != 'pending'`).groupBy(runs.harness, runs.model).all();
  return rows.sort((a, b) => b.total - a.total);
}
```

- [ ] **Step 4:** 运行测试通过：`npm test -- tests/db/stats.test.ts`。

- [ ] **Step 5:** 创建 `src/app/api/stats/route.ts`：

```ts
import { NextResponse } from "next/server";
import { getComboStats } from "@/lib/db";

export async function GET() {
  return NextResponse.json({ stats: getComboStats() });
}
```

- [ ] **Step 6:** 创建 `src/app/stats/page.tsx`：

```tsx
"use client";
import { useEffect, useState } from "react";

type ComboStat = {
  harness: string; model: string; total: number; completed: number;
  avgDurationMs: number | null; avgTokensIn: number | null; avgTokensOut: number | null; avgCostUsd: number | null;
};

const fmt = (ms: number | null) =>
  ms == null ? "—" : ms > 60000 ? `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s` : `${(ms / 1000).toFixed(1)}s`;

export default function StatsPage() {
  const [stats, setStats] = useState<ComboStat[]>([]);
  useEffect(() => {
    fetch("/api/stats").then((r) => r.json()).then((d) => setStats(d.stats ?? []));
  }, []);
  return (
    <main className="mx-auto w-full max-w-4xl space-y-4 p-8">
      <h1 className="text-2xl font-bold tracking-tight text-white/90">组合统计</h1>
      {stats.length === 0 && (
        <div className="glass rounded-3xl p-8 text-center text-sm text-white/40">还没有已开始的运行</div>
      )}
      {stats.length > 0 && (
        <div className="glass-strong overflow-x-auto rounded-3xl p-4">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-white/40">
                <th className="px-3 py-2 text-left font-medium">组合</th>
                <th className="px-3 py-2 text-right font-medium">运行次数</th>
                <th className="px-3 py-2 text-right font-medium">完成率</th>
                <th className="px-3 py-2 text-right font-medium">平均耗时</th>
                <th className="px-3 py-2 text-right font-medium">平均 tokens in→out</th>
                <th className="px-3 py-2 text-right font-medium">平均成本</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {stats.map((s) => (
                <tr key={`${s.harness}/${s.model}`} className="border-t border-white/5">
                  <td className="px-3 py-2 font-sans whitespace-nowrap text-white/85">{s.harness} · {s.model}</td>
                  <td className="px-3 py-2 text-right text-white/60">{s.total}</td>
                  <td className="px-3 py-2 text-right text-white/60">{Math.round((s.completed / s.total) * 100)}%</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-white/60">{fmt(s.avgDurationMs)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-white/60">
                    {s.avgTokensIn != null ? `${Math.round(s.avgTokensIn)} → ${Math.round(s.avgTokensOut ?? 0)}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-white/60">
                    {s.avgCostUsd != null ? `$${s.avgCostUsd.toFixed(4)}` : "n/a"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
```

- [ ] **Step 7:** 修改 `src/app/layout.tsx`：在「历史对局」Link 之后追加导航项：

```tsx
            <Link
              href="/stats"
              className="rounded-full px-3 py-1 text-white/60 transition-colors duration-200 hover:bg-white/10 hover:text-white"
            >
              统计
            </Link>
```

- [ ] **Step 8:** 运行 `npm test` 全绿。

- [ ] **Step 9:** 手工冒烟：访问 http://localhost:3001/stats → 出现各 harness×model 聚合行（用历史对局数据核对均值）。

- [ ] **Step 10:** 提交：

```powershell
git add -A; git commit -m "feat: cross-match combo statistics page"
```

---

### Task 11: 端到端验收与收尾

- [ ] **Step 1:** 全量测试：`npm test` 全绿（预期 18 + 7(files) + 4(diff) + 1(report) + 1(stats) = 31 个用例）。

- [ ] **Step 2:** Lint：`npm run lint` 通过；若有报错修复后重跑。

- [ ] **Step 3:** 确认 dev server 运行中（http://localhost:3001；若未运行则 `npm run dev`），完整走查：

1. 首页发起轻量对局（prompt「say ok」，opencode/ark/glm-5.2 单组合）→ 直播页：耗时实时走秒、轨迹自动滚动、点击事件行展开详情
2. 对局结束 → 顶部出现指标对比表（排序、最优高亮）
3. 「产出文件」点击 `hello.txt` → 弹层预览；若产出 HTML → iframe 沙箱试玩
4. 「产出对比」选两个 Run + 同名文件 → 红绿 diff
5. 「导出报告」→ 下载 md 并检查内容
6. 历史页：搜索关键字、切状态/harness 过滤、计数正确
7. `/stats`：聚合数据与历史对局一致

- [ ] **Step 4:** 若走查产生修复，提交：`git add -A; git commit -m "fix: ux enhancements e2e fixes"`

- [ ] **Step 5:** 最终确认 `git status --short` 干净、`git log --oneline` 每个功能独立成提交。

---

## 验收要点（Self-Review 结论）

- 9 项功能全部有对应 Task：文件预览（Task 1/2）、对比表（Task 5）、双 Run diff（Task 3/4）、实时计时（Task 6）、自动滚动与事件展开（Task 7）、历史过滤（Task 8）、报告导出（Task 9）、跨对局统计（Task 10）、外加 Task 0 清工作区与 Task 11 验收。
- 后端新逻辑（files/diff/report/getComboStats）均有 vitest 单测；API 路由为薄封装。
- 无新依赖；UI 全部沿用 glass 体系与既有配色；路径穿越有专门测试用例覆盖。
