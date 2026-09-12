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
