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
