"use client";
import type { ArenaEvent } from "@/lib/arena/types";

function EventLine({ e }: { e: ArenaEvent }) {
  const color =
    e.kind === "message" ? "text-gray-800" :
    e.kind === "thinking" ? "text-purple-600" :
    e.kind === "tool_call" || e.kind === "file_edit" ? "text-blue-600" :
    e.kind === "tool_result" || e.kind === "command" ? "text-gray-500" :
    e.kind === "error" ? "text-red-600" : "text-gray-400";
  const text =
    e.kind === "message" ? e.text :
    e.kind === "thinking" ? `思考：${e.text.slice(0, 200)}` :
    e.kind === "tool_call" ? `调用工具 ${e.tool}` :
    e.kind === "tool_result" ? `工具返回：${e.output.slice(0, 200)}` :
    e.kind === "file_edit" ? `编辑文件 ${e.path}` :
    e.kind === "command" ? `执行命令 ${e.command}（退出码 ${e.exitCode ?? "?"}）` :
    e.kind === "system" ? `[系统] ${e.text}` :
    e.kind === "error" ? `错误：${e.text}` : "完成";
  return <div className={`${color} font-mono text-xs truncate`} title={text}>{text}</div>;
}

export default function TrajectoryView({ events }: { events: ArenaEvent[] }) {
  return (
    <div className="h-48 overflow-y-auto border rounded bg-gray-50 p-2 space-y-1">
      {events.length === 0 && <div className="text-xs text-gray-400">等待事件…</div>}
      {events.map((e, i) => <EventLine key={i} e={e} />)}
    </div>
  );
}
