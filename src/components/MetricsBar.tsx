"use client";
import { useEffect, useState } from "react";

function Icon({ d }: { d: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round" className="size-3.5 opacity-60" aria-hidden>
      <path d={d} />
    </svg>
  );
}

export default function MetricsBar({
  durationMs, tokensIn, tokensOut, costUsd, startedAt, running,
}: { durationMs: number | null; tokensIn: number | null; tokensOut: number | null; costUsd: number | null;
     startedAt?: Date | string | null; running?: boolean }) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (!running || !startedAt) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [running, startedAt]);
  const liveMs = running && startedAt ? now - new Date(startedAt).getTime() : null;
  const shown = liveMs ?? durationMs;
  const fmt = (ms: number) => ms > 60000 ? `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s` : `${(ms / 1000).toFixed(1)}s`;
  return (
    <div className="glass flex items-center justify-between gap-2 rounded-full px-3 py-1.5 font-mono text-xs text-white/60">
      <span className={`flex items-center gap-1.5 ${running ? "text-sky-300" : ""}`} title="耗时">
        <Icon d="M12 6v6l4 2M22 12a10 10 0 1 1-20 0 10 10 0 0 1 20 0Z" />
        {shown != null ? fmt(shown) : "—"}
      </span>
      <span className="flex items-center gap-1.5" title="tokens 输入 → 输出">
        <Icon d="m17 11-5-5-5 5M17 18l-5 5-5-5" />
        {tokensIn != null ? `${tokensIn} → ${tokensOut}` : "n/a"}
      </span>
      <span className="flex items-center gap-1.5" title="成本（美元）">
        <Icon d="M12 2v20M17 5H9.5a3.5 3.5 0 0 0 0 7h5a3.5 3.5 0 0 1 0 7H6" />
        {costUsd != null ? `$${costUsd.toFixed(4)}` : "n/a"}
      </span>
    </div>
  );
}
