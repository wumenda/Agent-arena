"use client";
import { useEffect, useState } from "react";
import { motion } from "motion/react";
import type { RunRow } from "@/lib/db/schema";

// 沙箱渲染帧：按 file 加载内容并以 key 重挂载天然重置状态（file/reloadKey 变化即重新拉取）
function HtmlFrame({ matchId, runId, file, reloadKey, title }: {
  matchId: string; runId: string; file: string; reloadKey: number; title: string;
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
    <iframe
      title={title}
      sandbox="allow-scripts allow-modals allow-pointer-lock"
      srcDoc={content}
      className="h-[480px] w-full rounded-2xl border border-white/10 bg-white"
    />
  );
}

// 单个 Run 的浏览器卡片：拉取产出文件列表，选 HTML 入口，沙箱 iframe 渲染
function PreviewCard({ matchId, run }: { matchId: string; run: RunRow }) {
  const [htmlFiles, setHtmlFiles] = useState<string[]>([]);
  const [file, setFile] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  // 文件列表（仅本 run 变化时拉一次）
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
        // 入口优先级：index.html > main.html > 第一个
        const entry = htmls.find((p) => /(^|\/)index\.html?$/i.test(p))
          ?? htmls.find((p) => /(^|\/)main\.html?$/i.test(p))
          ?? htmls[0]
          ?? "";
        setFile(entry);
      })
      .catch(() => {});
    return () => { cancelled = true; };
  }, [matchId, run.id]);

  if (htmlFiles.length === 0) return null;

  const sel = "glass-input max-w-44 cursor-pointer truncate rounded-full px-3 py-1 text-xs text-white/85 outline-none";
  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      className="glass-strong w-[520px] shrink-0 space-y-2 rounded-3xl p-3"
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
      <HtmlFrame
        key={`${file}-${reloadKey}`}
        matchId={matchId}
        runId={run.id}
        file={file}
        reloadKey={reloadKey}
        title={`${run.harness} · ${run.model}`}
      />
    </motion.div>
  );
}

// 页面预览区：每个产出 HTML 的 Run 一张浏览器卡片并排对比（沙箱互相隔离）
export default function PreviewGrid({ matchId, runs }: { matchId: string; runs: RunRow[] }) {
  const previewable = runs.filter((r) => r.status === "completed" || r.status === "timeout");
  if (previewable.length === 0) return null;
  return (
    <section className="space-y-2">
      <div className="text-xs font-medium tracking-wide text-white/40 uppercase">页面预览（沙箱渲染，点击画面获得键盘焦点）</div>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {previewable.map((r) => (
          <PreviewCard key={r.id} matchId={matchId} run={r} />
        ))}
      </div>
    </section>
  );
}
