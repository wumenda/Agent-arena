"use client";
import { useEffect, useRef, useState } from "react";
import { motion } from "motion/react";
import type { RunRow } from "@/lib/db/schema";

// 沙箱渲染帧：按 file 加载内容；dark 切换画布底色（file 变化经组件 key 重挂载）；宽度撑满网格单元
function HtmlFrame({ matchId, runId, file, reloadKey, dark, title }: {
  matchId: string; runId: string; file: string; reloadKey: number; dark: boolean; title: string;
}) {
  const [content, setContent] = useState<string | null>(null);

  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    fetch(`/api/matches/${matchId}/file?runId=${runId}&path=${encodeURIComponent(file)}`)
      .then((r) => r.json())
      .then((d) => { if (!cancelled) setContent(d.content ?? null); })
      .catch(() => { if (!cancelled) setContent(null); });
    return () => { cancelled = true; };
  }, [matchId, runId, file, reloadKey]);

  if (!file) {
    return (
      <div className="flex h-[480px] w-full items-center justify-center rounded-2xl border border-white/10 bg-black/40 text-xs text-white/30">
        无 HTML 产出
      </div>
    );
  }
  if (content == null) {
    return (
      <div className="flex h-[480px] w-full items-center justify-center rounded-2xl border border-white/10 bg-black/40 text-xs text-white/30">
        加载中…
      </div>
    );
  }
  return (
    <div className={`w-full overflow-hidden rounded-2xl border border-white/10 ${dark ? "bg-zinc-900" : "bg-white"}`}>
      <iframe
        title={title}
        sandbox="allow-scripts allow-modals allow-pointer-lock"
        srcDoc={content}
        className="h-[480px] w-full border-0 bg-transparent"
      />
    </div>
  );
}

// 单个 Run 的浏览器卡片：拉取产出文件列表，选 HTML 入口，沙箱 iframe 渲染；宽度由全局统一控制
function PreviewCard({ matchId, run, tick, viewW }: { matchId: string; run: RunRow; tick: number; viewW: number }) {
  const [htmlFiles, setHtmlFiles] = useState<string[]>([]);
  const [file, setFile] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [dark, setDark] = useState(false);
  const [retryK, setRetryK] = useState(0);
  const retries = useRef(0);

  // 文件列表：run 变化 / live tick / 状态收敛（→completed 补拉最后一刻写入的文件）时重拉；
  // 请求失败自动重试（上限 3 次），避免完成瞬间一次失败导致卡片永久空白
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/matches/${matchId}/file?runId=${run.id}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((d) => {
        if (cancelled) return;
        retries.current = 0;
        const htmls: string[] = (d.files ?? [])
          .map((f: { path: string }) => f.path)
          .filter((p: string) => /\.html?$/i.test(p));
        setHtmlFiles(htmls);
        // 入口优先级：index.html > main.html > 第一个；仅在未选择时设置，保留用户已选文件
        setFile((prev) => {
          if (prev) return prev;
          return htmls.find((p) => /(^|\/)index\.html?$/i.test(p))
            ?? htmls.find((p) => /(^|\/)main\.html?$/i.test(p))
            ?? htmls[0]
            ?? "";
        });
      })
      .catch(() => {
        if (cancelled || retries.current >= 3) return;
        retries.current += 1;
        setTimeout(() => { if (!cancelled) setRetryK((k) => k + 1); }, 2500);
      });
    return () => { cancelled = true; };
  }, [matchId, run.id, run.status, tick, retryK]);

  const sel = "glass-input max-w-44 cursor-pointer truncate rounded-full px-3 py-1 text-xs text-white/85 outline-none";
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-strong shrink-0 space-y-2 rounded-3xl p-3"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-block size-2 shrink-0 rounded-full bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]" />
          <span className="truncate text-sm font-semibold text-white/90">{run.harness} · {run.model}</span>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {htmlFiles.length > 1 ? (
            <select className={sel} value={file} onChange={(e) => setFile(e.target.value)} title={file}>
              {htmlFiles.map((f) => <option key={f} value={f}>{f}</option>)}
            </select>
          ) : (
            <span className="max-w-44 truncate font-mono text-xs text-white/40" title={file}>{file}</span>
          )}
          <button
            className="cursor-pointer rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/70 transition-colors duration-200 hover:bg-white/20"
            title="重新加载页面"
            onClick={() => setReloadKey((k) => k + 1)}
          >
            ↻
          </button>
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 text-[10px] text-white/40">
        <button className="cursor-pointer rounded-full bg-white/5 px-2 py-0.5 hover:bg-white/10" onClick={() => setDark((d) => !d)}>
          {dark ? "浅色底" : "深色底"}
        </button>
      </div>
      <HtmlFrame
        key={file}
        matchId={matchId}
        runId={run.id}
        file={file}
        reloadKey={reloadKey}
        dark={dark}
        title={`${run.harness} · ${run.model}`}
      />
    </motion.div>
  );
}

// 页面预览区：每个 Run 一张浏览器卡片，自适应网格布局（无横向滚动）；
// 宽度档位决定每行列数：375→4 张、768→2 张、1280→1 张；live 时轮询新产出 HTML
const WIDTH_COLS: Record<number, number> = { 375: 4, 768: 2, 1280: 1 };

export default function PreviewGrid({ matchId, runs, live }: { matchId: string; runs: RunRow[]; live: boolean }) {
  const [tick, setTick] = useState(0);
  const [viewW, setViewW] = useState(768);
  useEffect(() => {
    if (!live) return;
    const t = setInterval(() => setTick((k) => k + 1), 5000);
    return () => clearInterval(t);
  }, [live]);
  if (runs.length === 0) return null;
  const cols = WIDTH_COLS[viewW] ?? 2;
  const colLabel: Record<number, string> = { 375: "4 张/行", 768: "2 张/行", 1280: "1 张/行" };
  return (
    <section className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs font-medium tracking-wide text-white/40 uppercase">页面预览（沙箱渲染，点击画面获得键盘焦点）</div>
        <div className="flex items-center gap-1.5 text-xs text-white/40">
          <span>每行卡片</span>
          {Object.keys(WIDTH_COLS).map(Number).map((w) => (
            <button
              key={w}
              title={`沙箱视口 ${w}px，每行 ${WIDTH_COLS[w]} 张`}
              className={`cursor-pointer rounded-full px-2.5 py-0.5 transition-colors duration-150 ${viewW === w ? "bg-sky-400/20 text-sky-300" : "glass-input text-white/60 hover:bg-white/10 hover:text-white"}`}
              onClick={() => setViewW(w)}
            >
              {colLabel[w]}
            </button>
          ))}
        </div>
      </div>
      <div className="grid gap-4" style={{ gridTemplateColumns: `repeat(${cols}, minmax(0, 1fr))` }}>
        {runs.map((r) => (
          <PreviewCard key={r.id} matchId={matchId} run={r} tick={tick} viewW={viewW} />
        ))}
      </div>
    </section>
  );
}
