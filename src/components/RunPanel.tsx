"use client";
import TrajectoryView from "./TrajectoryView";
import MetricsBar from "./MetricsBar";
import DiffView from "./DiffView";
import type { ArenaEvent } from "@/lib/arena/types";
import type { RunRow } from "@/lib/db/schema";

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-gray-200", running: "bg-blue-100 animate-pulse",
  completed: "bg-green-100", failed: "bg-red-100", timeout: "bg-yellow-100",
};

export default function RunPanel({ run, events }: { run: RunRow; events: ArenaEvent[] }) {
  return (
    <div className="border rounded-lg p-3 space-y-2 min-w-72">
      <div className="flex items-center justify-between">
        <div className="font-semibold text-sm">{run.harness} · {run.model}</div>
        <span className={`text-xs rounded px-2 py-0.5 ${STATUS_STYLE[run.status] ?? "bg-gray-100"}`}>{run.status}</span>
      </div>
      {run.error && <div className="text-xs text-red-600">{run.error}</div>}
      <MetricsBar durationMs={run.durationMs} tokensIn={run.tokensIn} tokensOut={run.tokensOut} costUsd={run.costUsd} />
      <TrajectoryView events={events} />
      {(run.status === "completed" || run.status === "timeout") && <DiffView events={events} />}
    </div>
  );
}
