"use client";
import TrajectoryView from "./TrajectoryView";
import MetricsBar from "./MetricsBar";
import DiffView from "./DiffView";
import { AnimatePresence, motion } from "motion/react";
import type { ArenaEvent } from "@/lib/arena/types";
import type { RunRow } from "@/lib/db/schema";

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-white/10 text-white/60",
  running: "bg-sky-400/15 text-sky-300 animate-pulse",
  completed: "bg-emerald-400/15 text-emerald-300",
  failed: "bg-red-400/15 text-red-300",
  timeout: "bg-amber-400/15 text-amber-300",
};

export default function RunPanel({ run, events, matchId, onRerunOne }: { run: RunRow; events: ArenaEvent[]; matchId: string; onRerunOne?: (combo: { harness: string; model: string }) => void }) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 20, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className="glass-strong w-80 shrink-0 space-y-3 rounded-3xl p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="truncate text-sm font-semibold text-white/90">{run.harness} · {run.model}</div>
        {/* 状态切换时弹跳换新 */}
        <AnimatePresence mode="popLayout" initial={false}>
          <motion.span
            key={run.status}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.12 } }}
            className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs ${STATUS_STYLE[run.status] ?? "bg-white/10 text-white/60"}`}
          >
            {run.status}
          </motion.span>
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {run.error && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: "auto" }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden rounded-xl bg-red-400/10 text-xs text-red-300"
          >
            <div className="px-3 py-2">{run.error}</div>
          </motion.div>
        )}
      </AnimatePresence>
      <MetricsBar durationMs={run.durationMs} tokensIn={run.tokensIn} tokensOut={run.tokensOut} costUsd={run.costUsd}
        startedAt={run.startedAt} running={run.status === "running"} />
      {onRerunOne && ["failed", "timeout", "completed"].includes(run.status) && (
        <div className="flex justify-end">
          <button
            className="cursor-pointer rounded-full bg-white/5 px-2.5 py-1 text-[10px] text-white/50 transition-colors duration-200 hover:bg-white/10 hover:text-white"
            onClick={() => onRerunOne({ harness: run.harness, model: run.model })}
          >
            ⟳ 重跑此组合
          </button>
        </div>
      )}
      <TrajectoryView events={events} />
      {(run.status === "completed" || run.status === "timeout") && <DiffView events={events} matchId={matchId} run={run} />}
    </motion.div>
  );
}
