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
