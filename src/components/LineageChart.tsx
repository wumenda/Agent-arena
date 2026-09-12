"use client";
import { useEffect, useState } from "react";

type GenRun = { harness: string; model: string; status: string; durationMs: number | null; costUsd: number | null };
type Gen = { id: string; createdAt: string; status: string; runs: GenRun[] };

const fmt = (ms: number | null) => ms == null ? "—" : ms > 60000 ? `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s` : `${(ms / 1000).toFixed(1)}s`;

// 血缘趋势：每代对局的组合耗时横条（纯 div，最长代为基准 100%）
export default function LineageChart({ matchId }: { matchId: string }) {
  const [gens, setGens] = useState<Gen[]>([]);
  useEffect(() => {
    let cancelled = false;
    fetch(`/api/matches/${matchId}/lineage`).then((r) => r.json()).then((d) => {
      if (!cancelled) setGens(d.lineage ?? []);
    }).catch(() => {});
    return () => { cancelled = true; };
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
