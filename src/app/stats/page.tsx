"use client";
import { useEffect, useState } from "react";
import { motion } from "motion/react";

type ComboStat = {
  harness: string; model: string; total: number; completed: number; timeouts: number;
  avgDurationMs: number | null; avgTokensIn: number | null; avgTokensOut: number | null; avgCostUsd: number | null;
};
type HarnessStat = {
  harness: string; total: number; completed: number; timeouts: number;
  avgDurationMs: number | null; totalCostUsd: number | null;
};
type TrendPoint = { date: string; total: number; completed: number; costUsd: number };

const fmt = (ms: number | null) =>
  ms == null ? "—" : ms > 60000 ? `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s` : `${(ms / 1000).toFixed(1)}s`;

const dayLabel = (date: string) => date.slice(5).replace("-", "/");

export default function StatsPage() {
  const [stats, setStats] = useState<ComboStat[]>([]);
  const [byHarness, setByHarness] = useState<HarnessStat[]>([]);
  const [trend, setTrend] = useState<TrendPoint[]>([]);
  useEffect(() => {
    // 首屏 + 5s 轮询：新对局跑完后统计自动跟上（本地工具，简单轮询即可）
    const refresh = () => {
      fetch("/api/stats").then((r) => r.json()).then((d) => {
        setStats(d.stats ?? []);
        setByHarness(d.byHarness ?? []);
        setTrend(d.trend ?? []);
      }).catch(() => {});
    };
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  const maxHarnessTotal = Math.max(1, ...byHarness.map((h) => h.total));
  const maxTrendTotal = Math.max(1, ...trend.map((t) => t.total));

  return (
    <main className="mx-auto w-full max-w-4xl space-y-6 p-8">
      <motion.h1
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="text-2xl font-bold tracking-tight text-white/90"
      >
        组合统计
      </motion.h1>

      {stats.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.06, duration: 0.35, ease: "easeOut" }}
          className="glass rounded-3xl p-8 text-center text-sm text-white/40"
        >
          还没有已开始的运行
        </motion.div>
      )}

      {byHarness.length > 0 && (
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.06, duration: 0.35, ease: "easeOut" }}
          className="glass-strong rounded-3xl p-5"
        >
          <h2 className="mb-3 text-sm font-medium text-white/60">Harness 对比</h2>
          <div className="space-y-3">
            {byHarness.map((h) => (
              <div key={h.harness} className="space-y-1">
                <div className="flex items-baseline justify-between gap-2 text-xs">
                  <span className="font-medium text-white/85">{h.harness}</span>
                  <span className="font-mono text-white/40">
                    {h.total} 次 · 完成率 {Math.round((h.completed / h.total) * 100)}%
                    {h.timeouts > 0 && ` · 超时 ${h.timeouts}`}
                    · 均耗时 {fmt(h.avgDurationMs)}
                    {h.totalCostUsd != null && ` · 累计 $${h.totalCostUsd.toFixed(4)}`}
                  </span>
                </div>
                <div className="h-2 overflow-hidden rounded-full bg-white/5">
                  <motion.div
                    initial={{ width: 0 }}
                    animate={{ width: `${(h.total / maxHarnessTotal) * 100}%` }}
                    transition={{ duration: 0.5, ease: "easeOut" }}
                    className="h-full rounded-full bg-sky-400/70"
                  >
                    <div
                      className="h-full rounded-full bg-emerald-400/80"
                      style={{ width: `${(h.completed / h.total) * 100}%` }}
                      title={`完成 ${h.completed}/${h.total}`}
                    />
                  </motion.div>
                </div>
              </div>
            ))}
          </div>
          <p className="mt-3 text-[10px] text-white/30">条形长度 = 运行次数；绿色段 = 完成的运行占比</p>
        </motion.section>
      )}

      {trend.some((t) => t.total > 0) && (
        <motion.section
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1, duration: 0.35, ease: "easeOut" }}
          className="glass-strong rounded-3xl p-5"
        >
          <h2 className="mb-3 text-sm font-medium text-white/60">近 14 天趋势</h2>
          <div className="flex h-32 items-end gap-1.5">
            {trend.map((t) => (
              <div key={t.date} className="flex min-w-0 flex-1 flex-col items-center gap-1">
                <div
                  className="flex w-full cursor-default flex-col justify-end"
                  style={{ height: "104px" }}
                  title={`${t.date}：${t.total} 次运行，完成 ${t.completed}${t.costUsd > 0 ? `，花费 $${t.costUsd.toFixed(4)}` : ""}`}
                >
                  {t.total > 0 && (
                    <div
                      className="w-full rounded-t-md bg-sky-400/25"
                      style={{ height: `${(t.total / maxTrendTotal) * 100}%`, minHeight: "4px" }}
                    >
                      <div
                        className="w-full rounded-t-md bg-emerald-400/80"
                        style={{ height: `${(t.completed / t.total) * 100}%` }}
                      />
                    </div>
                  )}
                </div>
                <span className="w-full truncate text-center font-mono text-[9px] text-white/30">
                  {dayLabel(t.date)}
                </span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[10px] text-white/30">柱高 = 当日运行次数；绿色 = 完成；悬停看当日明细</p>
        </motion.section>
      )}

      {stats.length > 0 && (
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.14, duration: 0.35, ease: "easeOut" }}
          className="glass-strong overflow-x-auto rounded-3xl p-4"
        >
          <table className="w-full text-xs">
            <thead>
              <tr className="text-white/40">
                <th className="px-3 py-2 text-left font-medium">组合</th>
                <th className="px-3 py-2 text-right font-medium">运行次数</th>
                <th className="px-3 py-2 text-right font-medium">完成率</th>
                <th className="px-3 py-2 text-right font-medium" title="15 分钟总超时被终止的次数——把『模型太慢』与『任务失败』区分开">超时</th>
                <th className="px-3 py-2 text-right font-medium">平均耗时</th>
                <th className="px-3 py-2 text-right font-medium">平均 tokens in→out</th>
                <th className="px-3 py-2 text-right font-medium">平均成本</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {stats.map((s, i) => (
                <motion.tr
                  key={`${s.harness}/${s.model}`}
                  initial={{ opacity: 0, x: -12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.18 + Math.min(i * 0.05, 0.5), duration: 0.25, ease: "easeOut" }}
                  className="border-t border-white/5"
                >
                  <td className="px-3 py-2 font-sans whitespace-nowrap text-white/85">{s.harness} · {s.model}</td>
                  <td className="px-3 py-2 text-right text-white/60">{s.total}</td>
                  <td className="px-3 py-2 text-right text-white/60">{Math.round((s.completed / s.total) * 100)}%</td>
                  <td className={`px-3 py-2 text-right ${s.timeouts > 0 ? "text-amber-300/90" : "text-white/60"}`}>{s.timeouts}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-white/60">{fmt(s.avgDurationMs)}</td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-white/60">
                    {s.avgTokensIn != null ? `${Math.round(s.avgTokensIn)} → ${Math.round(s.avgTokensOut ?? 0)}` : "—"}
                  </td>
                  <td className="px-3 py-2 text-right whitespace-nowrap text-white/60">
                    {s.avgCostUsd != null ? `$${s.avgCostUsd.toFixed(4)}` : "n/a"}
                  </td>
                </motion.tr>
              ))}
            </tbody>
          </table>
        </motion.div>
      )}
    </main>
  );
}
