"use client";

export default function MetricsBar({
  durationMs, tokensIn, tokensOut, costUsd,
}: { durationMs: number | null; tokensIn: number | null; tokensOut: number | null; costUsd: number | null }) {
  const fmt = (ms: number) => ms > 60000 ? `${Math.floor(ms / 60000)}m${Math.floor((ms % 60000) / 1000)}s` : `${(ms / 1000).toFixed(1)}s`;
  return (
    <div className="flex gap-4 text-xs text-gray-600">
      <span>⏱ {durationMs != null ? fmt(durationMs) : "—"}</span>
      <span> tokens: {tokensIn != null ? `${tokensIn} → ${tokensOut}` : "n/a"}</span>
      <span> 💰 {costUsd != null ? `$${costUsd.toFixed(4)}` : "n/a"}</span>
    </div>
  );
}
