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
  const [mode, setMode] = useState<"text" | "visual">("text");
  const [shot, setShot] = useState<{left: string; right: string; diff: string; diffCount: number} | null>(null);
  const [shotLoading, setShotLoading] = useState(false);
  const [shotError, setShotError] = useState("");

  const label = (id: string) => {
    const r = runs.find((x) => x.id === id);
    return r ? `${r.harness} · ${r.model}` : id;
  };

  // 切换 A/B 时在事件处理器中重置文件选择与视觉结果（避免在 effect 中同步 setState）
  const switchRun = (which: "A" | "B", id: string) => {
    if (which === "A") setRunA(id); else setRunB(id);
    setFile(""); setContentA(null); setContentB(null); setShot(null); setShotError("");
  };

  // 生成视觉对比：服务端用本机 Chrome 截两图 + pixelmatch 像素 diff
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

  useEffect(() => {
    if (!runA || !runB) return;
    let cancelled = false;
    Promise.all([
      fetch(`/api/matches/${matchId}/file?runId=${runA}`).then((r) => r.json()),
      fetch(`/api/matches/${matchId}/file?runId=${runB}`).then((r) => r.json()),
    ]).then(([a, b]) => {
      if (cancelled) return;
      setFilesA(a.files?.map((f: { path: string }) => f.path) ?? []);
      setFilesB(b.files?.map((f: { path: string }) => f.path) ?? []);
    });
    return () => { cancelled = true; };
  }, [matchId, runA, runB]);

  const common = useMemo(() => filesA.filter((f) => filesB.includes(f)), [filesA, filesB]);

  useEffect(() => {
    if (!file || !runA || !runB) return;
    let cancelled = false;
    Promise.all([
      fetch(`/api/matches/${matchId}/file?runId=${runA}&path=${encodeURIComponent(file)}`).then((r) => r.json()),
      fetch(`/api/matches/${matchId}/file?runId=${runB}&path=${encodeURIComponent(file)}`).then((r) => r.json()),
    ]).then(([a, b]) => {
      if (cancelled) return;
      setContentA(a.content ?? "");
      setContentB(b.content ?? "");
    });
    return () => { cancelled = true; };
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
          <select className={sel} value={runA} onChange={(e) => switchRun("A", e.target.value)}>
            {runs.map((r) => <option key={r.id} value={r.id}>A：{label(r.id)}</option>)}
          </select>
          <span className="text-white/30">vs</span>
          <select className={sel} value={runB} onChange={(e) => switchRun("B", e.target.value)}>
            {runs.map((r) => <option key={r.id} value={r.id}>B：{label(r.id)}</option>)}
          </select>
          <select className={sel} value={file} onChange={(e) => setFile(e.target.value)} disabled={common.length === 0}>
            <option value="">{common.length === 0 ? "无同名产出文件" : "选择文件…"}</option>
            {common.map((f) => <option key={f} value={f}>{f}</option>)}
          </select>
          <div className="flex overflow-hidden rounded-full bg-white/5 text-xs">
            {(["text", "visual"] as const).map((m) => (
              <button key={m} className={`cursor-pointer px-3 py-1 ${mode === m ? "bg-sky-400/20 text-sky-300" : "text-white/50 hover:text-white"}`} onClick={() => setMode(m)}>
                {m === "text" ? "文本" : "视觉"}
              </button>
            ))}
          </div>
        </div>
        {mode === "text" && diff && (
          <div className="mt-2 text-[10px] text-white/40">
            <span className="text-red-300">− {label(runA)}</span>
            <span className="mx-2">·</span>
            <span className="text-emerald-300">+ {label(runB)}</span>
          </div>
        )}
        {mode === "text" && diff && (
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
        {mode === "visual" && (
          <div className="mt-3 space-y-3 overflow-auto">
            {!file && <div className="text-xs text-white/40">先选择一个同名产出文件，再生成视觉对比。</div>}
            {file && (
              <div className="flex items-center gap-3">
                <button
                  className="cursor-pointer rounded-full bg-sky-400/20 px-4 py-1.5 text-xs text-sky-200 transition-colors duration-200 hover:bg-sky-400/30 disabled:cursor-not-allowed disabled:opacity-40"
                  disabled={shotLoading}
                  onClick={genShot}
                >
                  {shotLoading ? "截图中…" : "生成视觉对比"}
                </button>
                {shot && <span className="text-xs text-white/50">差异像素：<span className="font-mono text-amber-300">{shot.diffCount}</span></span>}
              </div>
            )}
            {shotError && <div className="rounded-xl bg-red-400/10 px-3 py-2 text-xs text-red-300">{shotError}</div>}
            {shot && (
              <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
                {([["A 原图", shot.left], ["像素差异", shot.diff], ["B 原图", shot.right]] as const).map(([t, img]) => (
                  <div key={t} className="space-y-1">
                    <div className="text-[10px] text-white/40">{t}</div>
                    {/* eslint-disable-next-line @next/next/no-img-element -- base64 data URI 场景不适用 next/image */}
                    <img src={`data:image/png;base64,${img}`} alt={t} className="w-full rounded-xl border border-white/10" />
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
