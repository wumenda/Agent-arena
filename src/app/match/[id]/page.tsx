"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import RunPanel from "@/components/RunPanel";
import type { ArenaEvent } from "@/lib/arena/types";
import type { RunRow } from "@/lib/db/schema";

export default function MatchPage() {
  const { id } = useParams<{ id: string }>();
  const [runs, setRuns] = useState<RunRow[]>([]);
  const [events, setEvents] = useState<Record<string, ArenaEvent[]>>({});
  const [matchStatus, setMatchStatus] = useState("…");

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
    if (res.ok) window.location.href = `/match/${d.match.id}`;
  };

  return (
    <main className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold">对局 {id} · {matchStatus}</h1>
        <button className="border rounded px-3 py-1 text-sm" onClick={rerun}>一键重跑（看方差）</button>
      </div>
      <div className="flex gap-4 overflow-x-auto">
        {runs.map((r) => (
          <RunPanel key={r.id} run={r} events={events[r.id] ?? []} />
        ))}
        {runs.length === 0 && <div className="text-gray-500">等待运行启动…</div>}
      </div>
    </main>
  );
}
