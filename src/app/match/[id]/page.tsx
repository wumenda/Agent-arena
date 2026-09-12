"use client";
import { useEffect, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import RunPanel from "@/components/RunPanel";
import RunDiff from "@/components/RunDiff";
import type { ArenaEvent } from "@/lib/arena/types";
import type { RunRow } from "@/lib/db/schema";

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-white/10 text-white/60",
  running: "bg-sky-400/15 text-sky-300 animate-pulse",
  completed: "bg-emerald-400/15 text-emerald-300",
  failed: "bg-red-400/15 text-red-300",
  timeout: "bg-amber-400/15 text-amber-300",
};

export default function MatchPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [events, setEvents] = useState<Record<string, ArenaEvent[]>>({});
  const [matchStatus, setMatchStatus] = useState("…");
  const [showDiff, setShowDiff] = useState(false);

  useEffect(() => {
    const load = async () => {
      const res = await fetch(`/api/matches/${id}`);
      if (res.ok) {
        const { match, runs } = await res.json();
        setRuns(runs);
        setMatchStatus(match.status);
        // 兜底回放：拉历史轨迹（刷新/断流后仍有数据）
        for (const r of runs) {
          if (!events[r.id] || events[r.id]!.length === 0) {
            const t = await fetch(`/api/matches/${id}/trajectory?runId=${r.id}`);
            const d = await t.json();
            if (d.events?.length) setEvents((prev) => ({ ...prev, [r.id]: d.events }));
          }
        }
      }
    };
    load();
    const poll = setInterval(load, 5000);
    const es = new EventSource(`/api/matches/${id}/stream`);
    es.onmessage = (m) => {
      const e = JSON.parse(m.data);
      if (e.channel === "run-event") {
        setEvents((prev) => ({ ...prev, [e.runId]: [...(prev[e.runId] ?? []), e.event] }));
      } else if (e.channel === "run-status") {
        setRuns((prev) => prev.map((r) => (r.id === e.runId ? { ...r, status: e.status, error: e.error ?? r.error } : r)));
      } else if (e.channel === "match-status") {
        setMatchStatus(e.status);
      }
    };
    return () => { clearInterval(poll); es.close(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id]);

  const rerun = async () => {
    const res = await fetch(`/api/matches/${id}/rerun`, { method: "POST" });
    const d = await res.json();
    if (res.ok) router.push(`/match/${d.match.id}`);
  };

  return (
    <main className="w-full space-y-4 p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="truncate font-mono text-sm text-white/50">对局 {id}</h1>
          {/* 对局状态切换时弹跳换新 */}
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={matchStatus}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.12 } }}
              className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs ${STATUS_STYLE[matchStatus] ?? "bg-white/10 text-white/60"}`}
            >
              {matchStatus}
            </motion.span>
          </AnimatePresence>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            className="glass cursor-pointer rounded-full px-4 py-1.5 text-sm text-white/70 transition-colors duration-200 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            disabled={runs.length < 2}
            onClick={() => setShowDiff(true)}
          >
            产出对比
          </button>
          <motion.button
            whileTap={{ scale: 0.95 }}
            className="glass shrink-0 cursor-pointer rounded-full px-4 py-1.5 text-sm text-white/70 transition-colors duration-200 hover:bg-white/10 hover:text-white"
            onClick={rerun}
          >
            一键重跑（看方差）
          </motion.button>
        </div>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-2">
        {runs.map((r) => (
          <RunPanel key={r.id} run={r} events={events[r.id] ?? []} matchId={id} />
        ))}
        {runs.length === 0 && (
          <div className="glass rounded-3xl p-8 text-sm text-white/40">等待运行启动…</div>
        )}
      </div>
      {showDiff && <RunDiff matchId={id} runs={runs} onClose={() => setShowDiff(false)} />}
    </main>
  );
}
