"use client";
import { useState } from "react";
import { motion } from "motion/react";
import FileViewer from "./FileViewer";
import type { ArenaEvent } from "@/lib/arena/types";
import type { RunDTO } from "@/lib/db/schema";

export default function DiffView({ events, matchId, run }: { events: ArenaEvent[]; matchId: string; run: RunDTO }) {
  const [viewing, setViewing] = useState<string | null>(null);
  // 事件里的文件路径可能是绝对路径（workdir 内）：文件 API 服务端 safeResolveFile 做包含校验，直接透传即可
  const files = [...new Set(events.filter((e) => e.kind === "file_edit").map((e) => (e as { path: string }).path))];
  const finalMessage = [...events].reverse().find((e) => e.kind === "message") as { text: string } | undefined;
  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className="min-h-0 flex-1 space-y-2 overflow-y-auto"
    >
      {files.length > 0 && (
        <div className="text-xs">
          <div className="font-medium tracking-wide text-white/40 uppercase">产出文件（点击查看）</div>
          {files.map((f) => (
            <motion.button
              key={f}
              whileTap={{ scale: 0.97 }}
              className="block max-w-full cursor-pointer truncate text-left font-mono text-sky-300 transition-colors duration-200 hover:text-sky-200 hover:underline"
              title={f}
              onClick={() => setViewing(f)}
            >
              {f}
            </motion.button>
          ))}
        </div>
      )}
      {finalMessage && (
        <div className="glass-input rounded-2xl p-3 text-xs">
          <div className="font-medium tracking-wide text-white/40 uppercase">最终回答</div>
          <div className="mt-1 whitespace-pre-wrap text-white/80">{finalMessage.text}</div>
        </div>
      )}
      {viewing && (
        <FileViewer key={viewing} matchId={matchId} runId={run.id} filePath={viewing} onClose={() => setViewing(null)} />
      )}
    </motion.div>
  );
}
