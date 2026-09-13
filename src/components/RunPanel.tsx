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

export default function RunPanel({ run, events, matchId, onRerunOne, onStopOne, id }: {
  run: RunRow; events: ArenaEvent[]; matchId: string; id?: string;
  onRerunOne?: (combo: { harness: string; model: string }) => void;
  onStopOne?: (runId: string) => void;
}) {
  return (
    <motion.div
      id={id}
      layout
      initial={{ opacity: 0, y: 20, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      className="glass-strong flex h-[44rem] w-[28rem] shrink-0 flex-col gap-3 overflow-hidden rounded-3xl p-4"
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
        startedAt={run.startedAt} running={run.status === "running"} verifyStatus={run.verifyStatus} />
      {onStopOne && run.status === "running" && (
        <div className="flex justify-end">
          <button
            className="flex cursor-pointer items-center gap-1 rounded-full bg-red-400/10 px-2.5 py-1 text-[10px] text-red-300 transition-colors duration-200 hover:bg-red-400/20"
            title="终止该 agent 进程，按 failed 落库"
            onClick={() => onStopOne(run.id)}
          >
            ■ 停止
          </button>
        </div>
      )}
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
