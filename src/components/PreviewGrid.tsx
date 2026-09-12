"use client";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import type { RunRow } from "@/lib/db/schema";

// 沙箱渲染帧：按 file 加载内容；viewW 控制视口宽度，dark 切换画布底色（file 变化经组件 key 重挂载）
function HtmlFrame({ matchId, runId, file, reloadKey, viewW, dark, title }: {
  matchId: string; runId: string; file: string; reloadKey: number; viewW: number; dark: boolean; title: string;
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
      <div
        className="flex h-[480px] items-center justify-center rounded-2xl border border-white/10 bg-black/40 text-xs text-white/30"
        style={{ width: viewW, maxWidth: "none" }}
      >
        无 HTML 产出
      </div>
    );
  }
  if (content == null) {
    return (
      <div
        className="flex h-[480px] items-center justify-center rounded-2xl border border-white/10 bg-black/40 text-xs text-white/30"
        style={{ width: viewW, maxWidth: "none" }}
      >
        加载中…
      </div>
    );
  }
  return (
    <div
      className={`overflow-x-auto rounded-2xl border border-white/10 ${dark ? "bg-zinc-900" : "bg-white"}`}
      style={{ width: viewW, maxWidth: "none" }}
    >
      <iframe
        title={title}
        sandbox="allow-scripts allow-modals allow-pointer-lock"
        srcDoc={content}
        style={{ width: viewW }}
        className="h-[480px] border-0 bg-transparent"
      />
    </div>
  );
}

// 单个 Run 的浏览器卡片：拉取产出文件列表，选 HTML 入口，沙箱 iframe 渲染；tick 驱动 live 重拉
function PreviewCard({ matchId, run, tick }: { matchId: string; run: RunRow; tick: number }) {
  const [htmlFiles, setHtmlFiles] = useState<string[]>([]);
  const [file, setFile] = useState("");
  const [reloadKey, setReloadKey] = useState(0);
  const [viewW, setViewW] = useState(1280);
  const [dark, setDark] = useState(false);

  // 文件列表（run 变化拉一次；live 下 tick 每 5s 重拉，产出新 HTML 自动进入下拉）
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/matches/${matchId}/file?runId=${run.id}`)
      .then((r) => r.json())
      .then((d) => {
        if (cancelled) return;
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
      .catch(() => {});
    return () => { cancelled = true; };
  }, [matchId, run.id, tick]);

  if (htmlFiles.length === 0) return null;

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
      <HtmlFrame
        key={file}
        matchId={matchId}
        runId={run.id}
        file={file}
        reloadKey={reloadKey}
        viewW={viewW}
        dark={dark}
        title={`${run.harness} · ${run.model}`}
      />
    </motion.div>
  );
}

// 页面预览区：每个 Run 一张浏览器卡片并排对比（沙箱互相隔离）；live 时轮询新产出 HTML
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
