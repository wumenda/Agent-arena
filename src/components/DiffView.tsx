"use client";
import type { ArenaEvent } from "@/lib/arena/types";

export default function DiffView({ events }: { events: ArenaEvent[] }) {
  const files = [...new Set(events.filter((e) => e.kind === "file_edit").map((e) => (e as { path: string }).path))];
  const finalMessage = [...events].reverse().find((e) => e.kind === "message") as { text: string } | undefined;
  return (
    <div className="space-y-2">
      {files.length > 0 && (
        <div className="text-xs">
          <div className="font-medium tracking-wide text-white/40 uppercase">产出文件</div>
          {files.map((f) => <div key={f} className="font-mono text-sky-300">{f}</div>)}
        </div>
      )}
      {finalMessage && (
        <div className="glass-input rounded-2xl p-3 text-xs">
          <div className="font-medium tracking-wide text-white/40 uppercase">最终回答</div>
          <div className="mt-1 whitespace-pre-wrap text-white/80">{finalMessage.text}</div>
        </div>
      )}
    </div>
  );
}
