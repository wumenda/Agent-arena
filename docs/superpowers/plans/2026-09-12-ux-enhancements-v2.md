# 模型-Agent 竞技场 · UX 增强 V2 实施计划（ux-enhancements-v2）

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 面向前端开发者的第二轮体验升级：运行中实时 HTML 预览、viewport 切换、部分重跑、对局删除、重跑血缘与趋势图、配置记忆/模板/prompt 历史、桌面通知、轨迹过滤、文件下载、HTML 视觉截图 diff。

**Architecture:** 复用既有 file API / 事件总线 / 玻璃风格；新增 lineage 血缘链（matches 加 `parent_match_id` 列 + 迁移逻辑）、截图 diff 服务（puppeteer-core 驱动本机 Chrome + pixelmatch 像素对比，Chrome 缺失时功能优雅降级）；其余全部为前端改造，图表用纯 div/SVG 不引入图表库。

**Tech Stack:** 现有栈 + 新增 npm 依赖 3 个：`puppeteer-core`（不下载浏览器，驱动本机 Chrome）、`pixelmatch`、`pngjs`。

**关键约束（勿偏离）：**
- 术语用 CONTEXT.md（对局/运行/组合/轨迹/指标）；密钥不入库；UI 只用 Tailwind + 现有 glass 体系；注释中文。
- 工作区纪律：执行时若工作区有与本任务无关的未提交变更，用 `git add <具体文件>` 精确暂存，禁止 `git add -A`。
- Next.js 16：route handler 的 params 是 Promise；带 `[id]` 的路径在 PowerShell 中加引号。
- React hooks 新规则（react-hooks/set-state-in-effect 等）：禁止在 effect 内同步 setState，状态重置放事件处理器或用 key 重挂载；fetch 需 cancelled 标志防竞态。
- 测试：纯逻辑（血缘遍历、像素 diff 封装、chrome 探测）必须 vitest 单测；dev server 在 http://localhost:3001。

---

## File Structure（最终形态）

```
src/
  lib/
    arena/
      paths.ts                  # 新增：workdirRoot()（runner 与删除共享）
      shot.ts                   # 新增：findChrome / renderShot / diffShots（puppeteer+pixelmatch）
    db/
      schema.ts                 # 修改：matches + parentMatchId
      index.ts                  # 修改：迁移列、createMatch 透传、deleteMatch、getLineage
  app/
    api/
      matches/[id]/route.ts     # 修改：+ DELETE
      matches/[id]/rerun/route.ts  # 修改：body 支持 {combos}，写 parentMatchId
      matches/[id]/lineage/route.ts  # 新增：血缘链
      matches/[id]/screenshot/route.ts  # 新增：截图+像素 diff
    matches/page.tsx 不变；history/page.tsx 修改（删除按钮）
    match/[id]/page.tsx         # 修改：部分重跑、通知、趋势图
  components/
    PreviewGrid.tsx             # 修改：运行中预览 + viewport + 深/浅
    ConfigForm.tsx              # 修改：记忆/模板
    page.tsx(首页)              # 修改：prompt 历史 chips
    TrajectoryView.tsx          # 修改：类型过滤
    FileViewer.tsx              # 修改：下载按钮
    RunDiff.tsx                 # 修改：视觉对比模式
    LineageChart.tsx            # 新增：趋势迷你图
tests/
  db/lineage.test.ts            # 新增
  arena/shot.test.ts            # 新增（仅纯函数部分）
```

依赖关系：Task 1（血缘+部分重跑）先于 Task 7（趋势图）；Task 6（截图）独立；其余独立。

---

### Task 1: 重跑血缘 + 部分重跑

**Files:**
- Modify: `src/lib/db/schema.ts`、`src/lib/db/index.ts`、`src/app/api/matches/[id]/rerun/route.ts`、`src/components/RunPanel.tsx`、`src/app/match/[id]/page.tsx`
- Test: `tests/db/lineage.test.ts`

- [ ] **Step 1:** 写失败测试 `tests/db/lineage.test.ts`：

```ts
process.env.ARENA_DB = ":memory:";
import { describe, it, expect } from "vitest";
import { createMatch, getLineage } from "@/lib/db/index";

describe("getLineage", () => {
  it("walks parent chain oldest-first including self", () => {
    const m1 = createMatch({ prompt: "p", combos: [{ harness: "opencode", model: "m" }] });
    const m2 = createMatch({ prompt: "p", combos: [{ harness: "opencode", model: "m" }], parentMatchId: m1.id });
    const m3 = createMatch({ prompt: "p", combos: [{ harness: "opencode", model: "m" }], parentMatchId: m2.id });
    const chain = getLineage(m3.id);
    expect(chain.map((m) => m.id)).toEqual([m1.id, m2.id, m3.id]);
  });
  it("returns single match without parent", () => {
    const m = createMatch({ prompt: "p", combos: [{ harness: "opencode", model: "m" }] });
    expect(getLineage(m.id)).toHaveLength(1);
  });
});
```

- [ ] **Step 2:** 运行 `npm test -- tests/db/lineage.test.ts` 确认失败（getLineage 不存在）。

- [ ] **Step 3:** 修改 `src/lib/db/schema.ts`：matches 表加一列（放在 createdAt 之前）：

```ts
  parentMatchId: text("parent_match_id"), // 重跑血缘：本对局由哪个对局重跑而来
```

- [ ] **Step 4:** 修改 `src/lib/db/index.ts`：
  1. `createDb` 的 `sqlite.exec(DDL)` 之后追加列迁移（已有库不重建，需 ALTER）：

```ts
  // 轻量迁移：旧库补列
  const cols = sqlite.pragma("table_info(matches)") as { name: string }[];
  if (!cols.some((c) => c.name === "parent_match_id")) {
    sqlite.exec("ALTER TABLE matches ADD COLUMN parent_match_id TEXT");
  }
```

  2. `createMatch` 入参与 values 透传：

```ts
export function createMatch(input: { prompt: string; combos: { harness: string; model: string }[]; status?: string; parentMatchId?: string }) {
  const id = nanoid();
  db.insert(matches).values({ id, prompt: input.prompt, combos: JSON.stringify(input.combos), status: input.status ?? "pending", parentMatchId: input.parentMatchId ?? null }).run();
  return getMatch(id)!;
}
```

  3. 底部追加（需 `import { eq, desc, sql } from "drizzle-orm";` 已有）：

```ts
// 血缘链：沿 parentMatchId 向上回溯，最老在前，含自身
export function getLineage(id: string) {
  const chain: MatchRow[] = [];
  let cur = getMatch(id);
  const guard = new Set<string>();
  while (cur && !guard.has(cur.id)) {
    guard.add(cur.id);
    chain.unshift(cur);
    cur = cur.parentMatchId ? getMatch(cur.parentMatchId) ?? null : null;
  }
  return chain;
}
```

- [ ] **Step 5:** 运行 `npm test -- tests/db/lineage.test.ts` 通过（2 用例）。

- [ ] **Step 6:** 修改 `src/app/api/matches/[id]/rerun/route.ts`（整体替换）：

```ts
import { NextRequest, NextResponse } from "next/server";
import { getMatch, createMatch } from "@/lib/db";
import { runMatch } from "@/lib/arena/runner";
import { MatchConfigSchema } from "@/lib/arena/types";

// 重跑：body 可选 {combos:[{harness,model}]}——指定则部分重跑，缺省全量；血缘指向原对局
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const old = getMatch(id);
  if (!old) return NextResponse.json({ error: "not found" }, { status: 404 });
  const body = await req.json().catch(() => ({}));
  let combos = JSON.parse(old.combos) as { harness: string; model: string }[];
  if (Array.isArray(body?.combos) && body.combos.length > 0) {
    const parsed = MatchConfigSchema.pick({ combos: true }).safeParse({ combos: body.combos });
    if (!parsed.success) return NextResponse.json({ error: parsed.error.flatten() }, { status: 400 });
    combos = parsed.data.combos;
  }
  const match = createMatch({ prompt: old.prompt, combos, parentMatchId: old.id });
  void runMatch(match.id);
  return NextResponse.json({ match }, { status: 201 });
}
```

- [ ] **Step 7:** 修改 `src/components/RunPanel.tsx`：
  1. props 加回调：`export default function RunPanel({ run, events, matchId, onRerunOne }: { run: RunRow; events: ArenaEvent[]; matchId: string; onRerunOne?: (combo: { harness: string; model: string }) => void })`
  2. MetricsBar 之后、TrajectoryView 之前插入重跑按钮行（仅终态显示）：

```tsx
      {onRerunOne && ["failed", "timeout", "completed"].includes(run.status) && (
        <div className="flex justify-end">
          <button
            className="cursor-pointer rounded-full bg-white/5 px-2.5 py-1 text-[10px] text-white/50 transition-colors duration-200 hover:bg-white/10 hover:text-white"
            onClick={() => onRerunOne({ harness: run.harness, model: run.model })}
          >
            ⟳ 重跑此组合
          </button>
        </div>
      )}
```

- [ ] **Step 8:** 修改 `src/app/match/[id]/page.tsx`：
  1. rerun 支持部分：

```tsx
  const rerun = async (combos?: { harness: string; model: string }[]) => {
    const res = await fetch(`/api/matches/${id}/rerun`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(combos ? { combos } : {}),
    });
    const d = await res.json();
    if (res.ok) router.push(`/match/${d.match.id}`);
  };
```

  2. RunPanel 调用处加 `onRerunOne={(c) => rerun([c])}`。
- [ ] **Step 9:** `npm test` 全量通过（31+2=33）；提交：`git add src/lib/db/schema.ts src/lib/db/index.ts "src/app/api/matches/[id]/rerun/route.ts" src/components/RunPanel.tsx "src/app/match/[id]/page.tsx" tests/db/lineage.test.ts` → `git commit -m "feat: rerun lineage and partial rerun per combo"`。

---

### Task 2: 对局删除

**Files:**
- Create: `src/lib/arena/paths.ts`
- Modify: `src/lib/arena/runner.ts`（复用 workdirRoot）、`src/lib/db/index.ts`（deleteMatch）、`src/app/api/matches/[id]/route.ts`（DELETE）、`src/app/history/page.tsx`（删除按钮）

- [ ] **Step 1:** 创建 `src/lib/arena/paths.ts`：

```ts
import os from "node:os";
import path from "node:path";

// 运行 workdir 根目录（与 runner 一致；独立成模块供删除逻辑复用）
export function workdirRoot() {
  return process.env.ARENA_WORKDIR_ROOT ?? path.join(os.tmpdir(), "model-agent-arena", "runs");
}
```

- [ ] **Step 2:** 修改 `src/lib/arena/runner.ts`：删除本地 `workdirRoot` 函数与相关 import（os），改为 `import { workdirRoot } from "./paths";`（删除 os/path 中不再使用的 path 需保留——executeRun 仍在用）。

- [ ] **Step 3:** `src/lib/db/index.ts` 底部追加：

```ts
import { rmSync } from "node:fs"; // 顶部 import 区

// 删除对局：清 runs/matches 行 + 磁盘 workdir 目录；running 中禁止删
export function deleteMatch(id: string): { ok: boolean; error?: string } {
  const match = getMatch(id);
  if (!match) return { ok: false, error: "not found" };
  const runRows = listRuns(id);
  if (runRows.some((r) => r.status === "running" || r.status === "pending")) {
    return { ok: false, error: "match is still running" };
  }
  db.delete(runs).where(eq(runs.matchId, id)).run();
  db.delete(matches).where(eq(matches.id, id)).run();
  if (runRows.length > 0) {
    const matchDir = path.dirname(runRows[0].workdir); // <root>/<matchId>
    rmSync(matchDir, { recursive: true, force: true });
  }
  return { ok: true };
}
```

- [ ] **Step 4:** `src/app/api/matches/[id]/route.ts` 追加 handler：

```ts
import { getMatch, listRuns, deleteMatch } from "@/lib/db";

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const result = deleteMatch(id);
  if (!result.ok) {
    const status = result.error === "not found" ? 404 : 409;
    return NextResponse.json({ error: result.error }, { status });
  }
  return NextResponse.json({ ok: true });
}
```

- [ ] **Step 5:** `src/app/history/page.tsx`：MatchRow 卡片由 `<Link>` 改为相对定位容器（保留 Link 跳转），右上角加删除按钮：

```tsx
  const [deleting, setDeleting] = useState<string | null>(null);
  const remove = async (mid: string) => {
    if (!confirm("删除该对局？轨迹文件将一并清除。")) return;
    setDeleting(mid);
    const res = await fetch(`/api/matches/${mid}`, { method: "DELETE" });
    setDeleting(null);
    if (res.ok) setMatches((prev) => prev.filter((m) => m.id !== mid));
  };
```

卡片结构：外层 `<div className="relative">` 包住原 Link（Link 加 `pr-10`），按钮：

```tsx
            <button
              className="absolute top-3 right-3 cursor-pointer rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/50 hover:bg-red-400/20 hover:text-red-300 disabled:opacity-40"
              title="删除对局"
              disabled={deleting === m.id}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); remove(m.id); }}
            >
              {deleting === m.id ? "…" : "✕"}
            </button>
```

- [ ] **Step 6:** `npm test` 全量 33 通过；精确提交：`git add src/lib/arena/paths.ts src/lib/arena/runner.ts src/lib/db/index.ts "src/app/api/matches/[id]/route.ts" src/app/history/page.tsx` → `git commit -m "feat: delete match with workdir cleanup"`。

---

### Task 3: 配置记忆 / 模板 / prompt 历史

**Files:**
- Modify: `src/components/ConfigForm.tsx`、`src/app/page.tsx`

- [ ] **Step 1:** 修改 `src/components/ConfigForm.tsx`：
  1. 顶部加模板常量：

```ts
const TEMPLATES: { name: string; combos: { harness: string; model: string }[] }[] = [
  { name: "三 harness 全对比", combos: [{ harness: "claude-code", model: "glm-5.3-flash" }, { harness: "codex", model: "glm-5.3-flash" }, { harness: "opencode", model: "ark/glm-5.2" }] },
  { name: "双雄对决", combos: [{ harness: "claude-code", model: "glm-5.3-flash" }, { harness: "codex", model: "glm-5.3-flash" }] },
  { name: "单跑 OpenCode", combos: [{ harness: "opencode", model: "ark/glm-5.2" }] },
];
```

  2. 挂载恢复 + 变更持久化（组件内，initial 为空才恢复）：

```ts
  useEffect(() => {
    if (initial?.combos?.length) return;
    try {
      const saved = localStorage.getItem("arena.lastCombos");
      if (saved) setCombos(JSON.parse(saved));
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    try { localStorage.setItem("arena.lastCombos", JSON.stringify(combos)); } catch {}
  }, [combos]);
```

  3. 模板按钮行渲染在「+ 添加组合」按钮同排之前：

```tsx
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-white/40">模板：</span>
          {TEMPLATES.map((t) => (
            <button key={t.name} className="glass-input cursor-pointer rounded-full px-2.5 py-0.5 text-xs text-white/70 hover:text-white" onClick={() => setCombos(t.combos.map((c) => ({ ...c })))}>
              {t.name}
            </button>
          ))}
        </div>
```

  4. start() 成功后记录 prompt 历史（`if (res.ok)` 分支内、router.push 之前）：

```ts
      try {
        const hist = JSON.parse(localStorage.getItem("arena.promptHistory") ?? "[]") as string[];
        const next = [prompt, ...hist.filter((p) => p !== prompt)].slice(0, 10);
        localStorage.setItem("arena.promptHistory", JSON.stringify(next));
        window.dispatchEvent(new Event("arena:prompt-history"));
      } catch {}
```

  5. 需要 `useEffect` 已在 imports 中（若无则加）。

- [ ] **Step 2:** 修改 `src/app/page.tsx`：prompt 历史 chips（textarea 下方）：

```tsx
  const [history, setHistory] = useState<string[]>([]);
  useEffect(() => {
    const load = () => { try { setHistory(JSON.parse(localStorage.getItem("arena.promptHistory") ?? "[]")); } catch {} };
    load();
    window.addEventListener("arena:prompt-history", load);
    return () => window.removeEventListener("arena:prompt-history", load);
  }, []);
```

渲染（一句话解析 section 内 textarea 与按钮行之间）：

```tsx
        {history.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-white/40">最近：</span>
            {history.slice(0, 5).map((p) => (
              <button key={p} title={p} className="glass-input max-w-56 cursor-pointer truncate rounded-full px-2.5 py-0.5 text-xs text-white/60 hover:text-white" onClick={() => setInput(p)}>
                {p}
              </button>
            ))}
          </div>
        )}
```

- [ ] **Step 3:** `npm test` 全量通过；提交 `git add src/components/ConfigForm.tsx src/app/page.tsx` → `git commit -m "feat: config memory, templates and prompt history"`。

---

### Task 4: 预览区增强（运行中预览 + viewport + 深/浅）

**Files:**
- Modify: `src/components/PreviewGrid.tsx`、`src/app/match/[id]/page.tsx`

- [ ] **Step 1:** 改造 `src/components/PreviewGrid.tsx`：
  1. PreviewGrid：去掉 status 过滤（running 也预览），加 live 轮询 tick：

```tsx
export default function PreviewGrid({ matchId, runs, live }: { matchId: string; runs: RunRow[]; live: boolean }) {
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setTick((k) => k + 1), 5000);
    return () => clearInterval(t);
  }, [live]);
  if (runs.length === 0) return null;
  return (
    <section className="space-y-2">
      <div className="text-xs font-medium tracking-wide text-white/40 uppercase">页面预览（沙箱渲染，点击画面获得键盘焦点）</div>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {runs.map((r) => (
          <PreviewCard key={r.id} matchId={matchId} run={r} tick={tick} />
        ))}
      </div>
    </section>
  );
}
```

  2. PreviewCard：props 加 `tick: number`；文件列表 effect 依赖改为 `[matchId, run.id, tick]`；新增 viewport 与背景状态：

```ts
  const [viewW, setViewW] = useState(1280);
  const [dark, setDark] = useState(false);
```

  3. 卡片宽度改为跟随内容：外层 `className="glass-strong shrink-0 space-y-2 rounded-3xl p-3"` 去掉 `w-[520px]`；头部第二行加控件行：

```tsx
      <div className="flex items-center justify-between gap-2 text-[10px] text-white/40">
        <div className="flex items-center gap-1">
          <span>宽度</span>
          {[375, 768, 1280].map((w) => (
            <button key={w} className={`cursor-pointer rounded-full px-2 py-0.5 ${viewW === w ? "bg-sky-400/20 text-sky-300" : "bg-white/5 hover:bg-white/10"}`} onClick={() => setViewW(w)}>{w}</button>
          ))}
        </div>
        <button className="cursor-pointer rounded-full bg-white/5 px-2 py-0.5 hover:bg-white/10" onClick={() => setDark((d) => !d)}>
          {dark ? "浅色底" : "深色底"}
        </button>
      </div>
```

  4. HtmlFrame：props 加 `viewW: number; dark: boolean`；iframe 外包背景容器：

```tsx
  return (
    <div className={`overflow-x-auto rounded-2xl border border-white/10 ${dark ? "bg-zinc-900" : "bg-white"}`} style={{ width: viewW, maxWidth: "none" }}>
      <iframe
        title={title}
        sandbox="allow-scripts allow-modals allow-pointer-lock"
        srcDoc={content}
        style={{ width: viewW }}
        className="h-[480px] border-0 bg-transparent"
      />
    </div>
  );
```

  加载中/无文件两个占位分支同样包 `style={{ width: viewW }}` 容器。调用处传 `viewW={viewW} dark={dark}`，key 改为 `key={file}`（reloadKey 保留手动刷新）。

- [ ] **Step 2:** `src/app/match/[id]/page.tsx` 挂载处改：`{<PreviewGrid matchId={id} runs={runs} live={matchStatus === "running"} />}`（去掉终态条件包裹，改为始终渲染）。

- [ ] **Step 3:** `npm test` 全量通过；提交 `git add src/components/PreviewGrid.tsx "src/app/match/[id]/page.tsx"` → `git commit -m "feat: live preview, viewport widths and dark canvas toggle"`。

---

### Task 5: 桌面通知 + 轨迹过滤 + 文件下载

**Files:**
- Modify: `src/app/match/[id]/page.tsx`、`src/components/TrajectoryView.tsx`、`src/components/FileViewer.tsx`

- [ ] **Step 1:** match page 通知：
  1. 头部按钮组最前加（仅 permission 为 default 时显示）：

```tsx
          {typeof Notification !== "undefined" && Notification.permission === "default" && (
            <button
              className="glass cursor-pointer rounded-full px-4 py-1.5 text-sm text-white/70 transition-colors duration-200 hover:bg-white/10 hover:text-white"
              title="对局结束时弹出系统通知"
              onClick={() => Notification.requestPermission()}
            >
              通知
            </button>
          )}
```

  2. 组件内加终态通知 effect（放在 rerun 函数后）：

```tsx
  useEffect(() => {
    if (!["completed", "partial"].includes(matchStatus)) return;
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification("对局已结束", { body: `对局 ${id} · ${matchStatus}` });
      }
    } catch {}
  }, [matchStatus, id]);
```

- [ ] **Step 2:** TrajectoryView 类型过滤：组件内加：

```tsx
  const GROUPS: { key: string; label: string; kinds: string[] }[] = [
    { key: "all", label: "全部", kinds: [] },
    { key: "msg", label: "消息", kinds: ["message"] },
    { key: "think", label: "思考", kinds: ["thinking"] },
    { key: "tool", label: "工具", kinds: ["tool_call", "tool_result", "command"] },
    { key: "file", label: "文件", kinds: ["file_edit"] },
    { key: "err", label: "异常", kinds: ["error", "system"] },
  ];
  const [group, setGroup] = useState("all");
  const shown = group === "all" ? events : events.filter((e) => GROUPS.find((g) => g.key === group)!.kinds.includes(e.kind));
```

  渲染：容器上方一行 chips（map GROUPS，选中高亮 `bg-sky-400/20 text-sky-300` 否则 `bg-white/5 text-white/50`），事件列表 `shown.map`；空态文案 `shown.length === 0 && …`。

- [ ] **Step 3:** FileViewer 下载按钮（关闭按钮左侧）：

```tsx
          {data && (
            <button
              className="shrink-0 cursor-pointer rounded-full bg-white/10 px-3 py-1 text-xs text-white/70 hover:bg-white/20"
              title="下载该文件"
              onClick={() => {
                const blob = new Blob([data.content], { type: "text/plain;charset=utf-8" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement("a");
                a.href = url;
                a.download = filePath.split("/").pop() ?? "file.txt";
                a.click();
                URL.revokeObjectURL(url);
              }}
            >
              ⬇ 下载
            </button>
          )}
```

- [ ] **Step 4:** `npm test` 全量通过；提交 `git add "src/app/match/[id]/page.tsx" src/components/TrajectoryView.tsx src/components/FileViewer.tsx` → `git commit -m "feat: desktop notification, trajectory filter and file download"`。

---

### Task 6: HTML 视觉截图 diff（puppeteer-core + pixelmatch）

**Files:**
- Modify: `package.json`（新依赖）、`next.config.ts`（serverExternalPackages + puppeteer-core）、`src/components/RunDiff.tsx`
- Create: `src/lib/arena/shot.ts`、`src/app/api/matches/[id]/screenshot/route.ts`
- Test: `tests/arena/shot.test.ts`（仅纯函数）

- [ ] **Step 1:** 安装依赖（puppeteer-core 不下载浏览器）：

```powershell
npm install puppeteer-core pixelmatch pngjs
npm install -D @types/pngjs
```

- [ ] **Step 2:** `next.config.ts` serverExternalPackages 改为：

```ts
  serverExternalPackages: ["better-sqlite3", "puppeteer-core"],
```

- [ ] **Step 3:** 写失败测试 `tests/arena/shot.test.ts`：

```ts
import { describe, it, expect } from "vitest";
import { findChrome, hashKey } from "@/lib/arena/shot";

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
```

运行确认失败。

- [ ] **Step 4:** 创建 `src/lib/arena/shot.ts`：

```ts
import { existsSync } from "node:fs";
import path from "node:path";
import puppeteer from "puppeteer-core";

const CHROME_CANDIDATES = [
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}/Google/Chrome/Application/chrome.exe` : "",
  "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
  "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
].filter(Boolean);

// 探测本机 Chrome/Edge；找不到返回 null（视觉 diff 功能降级不可用）
export function findChrome(): string | null {
  return CHROME_CANDIDATES.find((p) => existsSync(p)) ?? null;
}

// 稳定哈希：截图缓存文件名（内容不变不重截）
export function hashKey(...parts: string[]): string {
  let h = 5381;
  for (const s of parts) for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

export type ShotResult = { file: string };

// 渲染 HTML 并截图（1280x800）
export async function renderShot(html: string, outFile: string): Promise<ShotResult> {
  const chrome = findChrome();
  if (!chrome) throw new Error("chrome not found");
  const browser = await puppeteer.launch({ executablePath: chrome, headless: true, args: ["--no-sandbox"] });
  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1280, height: 800 });
    await page.setContent(html, { waitUntil: "networkidle0", timeout: 20000 });
    await page.screenshot({ path: outFile });
    return { file: outFile };
  } finally {
    await browser.close();
  }
}
```

运行 `npm test -- tests/arena/shot.test.ts` 通过。

- [ ] **Step 5:** 创建 `src/app/api/matches/[id]/screenshot/route.ts`：

```ts
import { NextRequest, NextResponse } from "next/server";
import { mkdirSync, readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { getMatch, listRuns } from "@/lib/db";
import { findChrome, renderShot, hashKey } from "@/lib/arena/shot";
import { pixelmatch } from "pixelmatch";
import { PNG } from "pngjs";

const SHOT_DIR = path.join(".arena", "shots");

// POST {left:{runId,path}, right:{runId,path}} → 截两图 + pixelmatch → 三张 base64
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const match = getMatch(id);
  if (!match) return NextResponse.json({ error: "not found" }, { status: 404 });
  if (!findChrome()) return NextResponse.json({ error: "本机未找到 Chrome/Edge，视觉对比不可用" }, { status: 501 });
  const body = await req.json();
  const runs = listRuns(id);
  const resolveHtml = (side: { runId: string; path: string }) => {
    const run = runs.find((r) => r.id === side.runId);
    if (!run) throw new Error("run not found");
    const raw = readFileSync(path.join(run.workdir, side.path), "utf8");
    return { html: raw, key: hashKey(id, side.runId, side.path, String(raw.length)) };
  };
  try {
    mkdirSync(SHOT_DIR, { recursive: true });
    const shoot = async (side: { runId: string; path: string }) => {
      const { html, key } = resolveHtml(side);
      const outFile = path.join(SHOT_DIR, `${id}-${key}.png`);
      if (!existsSync(outFile)) await renderShot(html, outFile);
      return PNG.sync.read(readFileSync(outFile));
    };
    const a = await shoot(body.left);
    const b = await shoot(body.right);
    const { width, height } = a;
    const diff = new PNG({ width, height });
    const diffCount = pixelmatch(a.data, b.data, diff.data, width, height, { threshold: 0.1 });
    const toB64 = (png: PNG) => PNG.sync.write(png).toString("base64");
    return NextResponse.json({
      left: toB64(a), right: toB64(b), diff: toB64(diff), diffCount,
      width, height,
    });
  } catch (err) {
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
```

- [ ] **Step 6:** 修改 `src/components/RunDiff.tsx` 加视觉模式：
  1. 状态：`const [mode, setMode] = useState<"text" | "visual">("text");`、`const [shot, setShot] = useState<{left:string;right:string;diff:string;diffCount:number}|null>(null);`、`const [shotLoading, setShotLoading] = useState(false);`、`const [shotError, setShotError] = useState("");`
  2. 模式切换 tabs（文件下拉旁）：

```tsx
          <div className="flex overflow-hidden rounded-full bg-white/5 text-xs">
            {(["text", "visual"] as const).map((m) => (
              <button key={m} className={`cursor-pointer px-3 py-1 ${mode === m ? "bg-sky-400/20 text-sky-300" : "text-white/50 hover:text-white"}`} onClick={() => setMode(m)}>
                {m === "text" ? "文本" : "视觉"}
              </button>
            ))}
          </div>
```

  3. 视觉模式下：原 diff 区域替换为「生成视觉对比」按钮 + 结果三图（左/差异/右，`w-full` img，`src={\`data:image/png;base64,${shot.left}\`}`）+ `差异像素：{shot.diffCount}`；点击生成：

```tsx
  const genShot = async () => {
    if (!file) return;
    setShotLoading(true); setShotError(""); setShot(null);
    try {
      const res = await fetch(`/api/matches/${matchId}/screenshot`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ left: { runId: runA, path: file }, right: { runId: runB, path: file } }),
      });
      const d = await res.json();
      if (!res.ok) setShotError(d.error ?? "生成失败");
      else setShot(d);
    } finally {
      setShotLoading(false);
    }
  };
```

  4. 文本/视觉区域互斥渲染（`mode === "text" ? 文本diff区 : 视觉区`）。注意 switchRun 切 A/B 时清空 shot（加 setShot(null)）。
- [ ] **Step 7:** `npm test` 全量通过（33+2=35）；提交 `git add package.json package-lock.json next.config.ts src/lib/arena/shot.ts "src/app/api/matches/[id]/screenshot/route.ts" src/components/RunDiff.tsx tests/arena/shot.test.ts` → `git commit -m "feat: visual screenshot diff via local chrome and pixelmatch"`。
- [ ] **Step 8:** 手工冒烟（Task 8 一并）：dev server 重启后（serverExternalPackages 变更）对含同名 HTML 的对局点「产出对比 → 视觉」生成三图。

---

### Task 7: 血缘趋势图

**Files:**
- Modify: `src/app/api/matches/[id]/lineage/route.ts`（新增）、`src/app/match/[id]/page.tsx`
- Create: `src/components/LineageChart.tsx`

- [ ] **Step 1:** 创建 `src/app/api/matches/[id]/lineage/route.ts`：

```ts
import { NextRequest, NextResponse } from "next/server";
import { getLineage } from "@/lib/db";

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const chain = getLineage(id);
  if (chain.length === 0) return NextResponse.json({ error: "not found" }, { status: 404 });
  return NextResponse.json({
    lineage: chain.map((m) => ({
      id: m.id,
      createdAt: m.createdAt,
      status: m.status,
      runs: JSON.parse(m.combos).length, // 占位不返回全 runs，前端按需取
    })),
  });
}
```

（注意：趋势图需要每代的 runs 指标——直接在此处展开：改为返回 `runs: listRuns(m.id).map(r => ({harness, model, status, durationMs, costUsd}))`，需 `import { getLineage, listRuns } from "@/lib/db"`。以实现为准，上面 runs 字段替换为完整指标。）

- [ ] **Step 2:** 创建 `src/components/LineageChart.tsx`：

```tsx
"use client";
import { useEffect, useState } from "react";

type GenRun = { harness: string; model: string; status: string; durationMs: number | null; costUsd: number | null };
type Gen = { id: string; createdAt: string; status: string; runs: GenRun[] };

const fmt = (ms: number | null) => ms == null ? "—" : ms > 60000 ? `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s` : `${(ms / 1000).toFixed(1)}s`;

// 血缘趋势：每代对局的组合耗时横条（纯 div，最长代为基准 100%）
export default function LineageChart({ matchId }: { matchId: string }) {
  const [gens, setGens] = useState<Gen[]>([]);
  useEffect(() => {
    fetch(`/api/matches/${matchId}/lineage`).then((r) => r.json()).then((d) => setGens(d.lineage ?? []));
  }, [matchId]);
  if (gens.length <= 1) return null;
  const max = Math.max(...gens.flatMap((g) => g.runs.map((r) => r.durationMs ?? 0)), 1);
  return (
    <section className="glass-strong space-y-2 rounded-3xl p-4">
      <div className="text-xs font-medium tracking-wide text-white/40 uppercase">重跑趋势（同任务历次对局）</div>
      <div className="space-y-2">
        {gens.map((g, gi) => (
          <div key={g.id} className="space-y-1">
            <div className="font-mono text-[10px] text-white/35">
              第 {gi + 1} 代 · {new Date(g.createdAt).toLocaleString()} · <a className="text-sky-300 hover:underline" href={`/match/${g.id}`}>{g.id}</a>
            </div>
            {g.runs.map((r, ri) => (
              <div key={ri} className="flex items-center gap-2 text-xs">
                <span className="w-40 shrink-0 truncate text-white/60">{r.harness}·{r.model}</span>
                <div className="h-3 flex-1 overflow-hidden rounded-full bg-white/5">
                  <div
                    className={`h-full rounded-full ${r.status === "completed" ? "bg-sky-400/60" : r.status === "failed" ? "bg-red-400/40" : "bg-amber-400/40"}`}
                    style={{ width: `${Math.max(2, Math.round(((r.durationMs ?? 0) / max) * 100))}%` }}
                  />
                </div>
                <span className="w-16 shrink-0 text-right font-mono text-white/50">{fmt(r.durationMs)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
    </section>
  );
}
```

- [ ] **Step 3:** match page：import LineageChart，挂在 ComparisonTable 之后：

```tsx
      <LineageChart matchId={id} />
```

- [ ] **Step 4:** `npm test` 全量通过；提交 `git add "src/app/api/matches/[id]/lineage/route.ts" src/components/LineageChart.tsx "src/app/match/[id]/page.tsx"` → `git commit -m "feat: rerun lineage trend chart"`。

---

### Task 8: 端到端验收

- [ ] **Step 1:** `npm test` 全绿（35）；`npm run lint` 0 错误。
- [ ] **Step 2:** 重启 dev server（Task 6 改了 next.config.ts），完整 API 走查：
  1. 发起双组合对局（opencode ark/glm-5.2 + opencode/deepseek-v4-flash-free，后者常失败正好验证部分重跑）→ 运行中观察 /api/matches/[id]/file 列表轮询与预览
  2. 结束后：失败组合卡片「⟳ 重跑此组合」→ 新对局 parentMatchId 正确（/api/matches/[newId] 检查）
  3. /api/matches/[newId]/lineage 返回两代；对局页出现趋势图
  4. 产出对比 → 视觉：三图 + diffCount（若本机无 Chrome 验证 501 降级提示）
  5. 历史页删除一个对局 → 确认 workdir 目录被清（Get-ChildItem tmp 目录）
  6. 首页：模板填充、prompt 历史 chips、刷新后 combos 恢复
- [ ] **Step 3:** 修复问题后提交 `git add -A`（若工作区干净仅剩修复）→ `git commit -m "fix: ux v2 e2e fixes"`。
- [ ] **Step 4:** 最终 `git status --short` 干净，逐功能独立提交可追溯。

---

## Self-Review 结论

- 14 项 → 映射：#1/#2/#3 → Task 4；#4/#6 → Task 1；#5 → Task 2；#7/#8/#9 → Task 3；#10/#11/#12 → Task 5；#13 → Task 6；#14 → Task 7（依赖 Task 1 的血缘）。全覆盖。
- 纯逻辑单测：lineage（2）、shot helpers（2）；UI 组件沿用全量回归。
- 已知风险：Task 6 依赖本机 Chrome/Edge，无则 API 501 前端展示降级提示；puppeteer-core 需 serverExternalPackages 防打包；Task 1 的 ALTER TABLE 迁移对已有 .arena/arena.db 生效。
