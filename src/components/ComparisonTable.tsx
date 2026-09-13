"use client";
import { useMemo, useState } from "react";
import type { RunDTO } from "@/lib/db/schema";
import { fmtDuration } from "@/lib/format";

type SortKey = "duration" | "tokensIn" | "tokensOut" | "cost";

// 对局结束后的指标汇总表：列可排序，completed 中的最优值（越低越好）高亮
export default function ComparisonTable({ runs }: { runs: RunDTO[] }) {
  const [sortKey, setSortKey] = useState<SortKey>("duration");
  const [asc, setAsc] = useState(true);

  const get = (r: RunDTO) =>
    (sortKey === "duration" ? r.durationMs : sortKey === "cost" ? r.costUsd : sortKey === "tokensIn" ? r.tokensIn : r.tokensOut)
    ?? Number.POSITIVE_INFINITY;

  const sorted = useMemo(
    () => [...runs].sort((x, y) => (asc ? get(x) - get(y) : get(y) - get(x))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [runs, sortKey, asc]
  );

  const best = useMemo(() => {
    const done = runs.filter((r) => r.status === "completed");
    const min = (f: (r: RunDTO) => number | null) => {
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

  // 修复验证列：仅当存在验证结果（题目带测试套件的对局）时显示
  const showVerify = runs.some((r) => r.verifyStatus != null);
  const VERIFY_BADGE: Record<string, { text: string; cls: string; title: string }> = {
    passed: { text: "✓ 通过", cls: "text-emerald-300", title: "测试套件通过" },
    failed: { text: "✗ 未通过", cls: "text-red-300", title: "测试套件未通过（详见 verify.log）" },
    skipped: { text: "— 跳过", cls: "text-white/40", title: "题目无测试套件" },
  };

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
            {showVerify && <th className="px-3 py-2 text-right font-medium">验证</th>}
          </tr>
        </thead>
        <tbody className="font-mono">
          {sorted.map((r) => (
            <tr key={r.id} className="border-t border-white/5">
              <td className="px-3 py-2 font-sans whitespace-nowrap text-white/85">{r.harness} · {r.model}</td>
              <td className="px-3 py-2 font-sans text-white/50">{r.status}</td>
              <td className={`px-3 py-2 text-right whitespace-nowrap ${isBest(r.durationMs, best.duration) ? "text-emerald-300" : "text-white/60"}`}>
                {r.durationMs != null ? fmtDuration(r.durationMs) : "—"}
              </td>
              <td className={`px-3 py-2 text-right ${isBest(r.tokensIn, best.tokensIn) ? "text-emerald-300" : "text-white/60"}`}>{r.tokensIn ?? "—"}</td>
              <td className={`px-3 py-2 text-right ${isBest(r.tokensOut, best.tokensOut) ? "text-emerald-300" : "text-white/60"}`}>{r.tokensOut ?? "—"}</td>
              <td className={`px-3 py-2 text-right whitespace-nowrap ${isBest(r.costUsd, best.cost) ? "text-emerald-300" : "text-white/60"}`}>
                {r.costUsd != null ? `$${r.costUsd.toFixed(4)}` : "n/a"}
              </td>
              {showVerify && (
                <td className="px-3 py-2 text-right font-sans whitespace-nowrap" title={r.verifyStatus ? VERIFY_BADGE[r.verifyStatus]?.title : undefined}>
                  {r.verifyStatus ? (
                    <span className={VERIFY_BADGE[r.verifyStatus]?.cls ?? "text-white/40"}>{VERIFY_BADGE[r.verifyStatus]?.text ?? r.verifyStatus}</span>
                  ) : "—"}
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
