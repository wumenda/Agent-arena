"use client";
import TrajectoryView from "./TrajectoryView";
import MetricsBar from "./MetricsBar";
import DiffView from "./DiffView";
import type { ArenaEvent } from "@/lib/arena/types";
import type { RunRow } from "@/lib/db/schema";

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-white/10 text-white/60",
  running: "bg-sky-400/15 text-sky-300 animate-pulse",
  completed: "bg-emerald-400/15 text-emerald-300",
  failed: "bg-red-400/15 text-red-300",
  timeout: "bg-amber-400/15 text-amber-300",
};

export default function RunPanel({ run, events, matchId }: { run: RunRow; events: ArenaEvent[]; matchId: string }) {
  return (
    <div className="glass-strong w-80 shrink-0 space-y-3 rounded-3xl p-4">
      <div className="flex items-center justify-between gap-2">
        <div className="truncate text-sm font-semibold text-white/90">{run.harness} · {run.model}</div>
        <span className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs ${STATUS_STYLE[run.status] ?? "bg-white/10 text-white/60"}`}>
          {run.status}
        </span>
      </div>
      {run.error && (
        <div className="rounded-xl bg-red-400/10 px-3 py-2 text-xs text-red-300">{run.error}</div>
      )}
      <MetricsBar durationMs={run.durationMs} tokensIn={run.tokensIn} tokensOut={run.tokensOut} costUsd={run.costUsd} />
      <TrajectoryView events={events} />
      {(run.status === "completed" || run.status === "timeout") && <DiffView events={events} matchId={matchId} run={run} />}
    </div>
  );
}
