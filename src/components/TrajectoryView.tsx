"use client";
import { motion } from "motion/react";
import type { ArenaEvent } from "@/lib/arena/types";

function EventLine({ e }: { e: ArenaEvent }) {
  const color =
    e.kind === "message" ? "text-white/85" :
    e.kind === "thinking" ? "text-violet-300" :
    e.kind === "tool_call" || e.kind === "file_edit" ? "text-sky-300" :
    e.kind === "tool_result" || e.kind === "command" ? "text-white/45" :
    e.kind === "error" ? "text-red-300" : "text-white/30";
  const text =
    e.kind === "message" ? e.text :
    e.kind === "thinking" ? `思考：${e.text.slice(0, 200)}` :
    e.kind === "tool_call" ? `调用工具 ${e.tool}` :
    e.kind === "tool_result" ? `工具返回：${e.output.slice(0, 200)}` :
    e.kind === "file_edit" ? `编辑文件 ${e.path}` :
    e.kind === "command" ? `执行命令 ${e.command}（退出码 ${e.exitCode ?? "?"}）` :
    e.kind === "system" ? `[系统] ${e.text}` :
    e.kind === "error" ? `错误：${e.text}` : "完成";
  // 新事件行从左侧滑入（仅 transform/opacity，保证 60fps）
  return (
    <motion.div
      initial={{ opacity: 0, x: -8 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.2, ease: "easeOut" }}
      className={`${color} font-mono text-xs leading-5 truncate`}
      title={text}
    >
      {text}
    </motion.div>
  );
}

export default function TrajectoryView({ events }: { events: ArenaEvent[] }) {
  return (
    <div className="h-48 space-y-0.5 overflow-y-auto rounded-2xl border border-white/10 bg-black/40 p-2.5 shadow-inner">
      {events.length === 0 && <div className="text-xs text-white/30">等待事件…</div>}
      {events.map((e, i) => <EventLine key={i} e={e} />)}
    </div>
  );
}
