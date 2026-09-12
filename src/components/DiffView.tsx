"use client";
import type { ArenaEvent } from "@/lib/arena/types";

export default function DiffView({ events }: { events: ArenaEvent[] }) {
  const files = [...new Set(events.filter((e) => e.kind === "file_edit").map((e) => (e as { path: string }).path))];
  const finalMessage = [...events].reverse().find((e) => e.kind === "message") as { text: string } | undefined;
  return (
    <div className="space-y-2">
      {files.length > 0 && (
        <div className="text-xs">
          <div className="font-semibold">产出文件：</div>
          {files.map((f) => <div key={f} className="font-mono text-blue-700">{f}</div>)}
        </div>
      )}
      {finalMessage && (
        <div className="text-xs border rounded p-2 bg-white">
          <div className="font-semibold">最终回答：</div>
          <div className="whitespace-pre-wrap">{finalMessage.text}</div>
        </div>
      )}
    </div>
  );
}
