"use client";
import { useEffect, useRef, useState } from "react";
import type { ArenaEvent } from "@/lib/arena/types";

function eventSummary(e: ArenaEvent): string {
  return e.kind === "message" ? e.text :
    e.kind === "thinking" ? `思考：${e.text.slice(0, 200)}` :
    e.kind === "tool_call" ? `调用工具 ${e.tool}` :
    e.kind === "tool_result" ? `工具返回：${e.output.slice(0, 200)}` :
    e.kind === "file_edit" ? `编辑文件 ${e.path}` :
    e.kind === "command" ? `执行命令 ${e.command}（退出码 ${e.exitCode ?? "?"}）` :
    e.kind === "system" ? `[系统] ${e.text.slice(0, 200)}` :
    e.kind === "error" ? `错误：${e.text.slice(0, 200)}` : "完成";
}

function eventFull(e: ArenaEvent): string {
  switch (e.kind) {
    case "message": return e.text;
    case "thinking": return e.text;
    case "tool_call": return `${e.tool}\n${JSON.stringify(e.input, null, 2)}`;
    case "tool_result": return e.output;
    case "file_edit": return e.path;
    case "command": return `${e.command}${e.output ? `\n${e.output}` : ""}`;
    case "system": return e.text;
    case "error": return e.text;
    case "done": return e.usage ? `tokens: ${e.usage.input} → ${e.usage.output}${e.costUsd != null ? `\ncost: $${e.costUsd}` : ""}` : "完成";
  }
}

function eventColor(e: ArenaEvent): string {
  return e.kind === "message" ? "text-white/85" :
    e.kind === "thinking" ? "text-violet-300" :
    e.kind === "tool_call" || e.kind === "file_edit" ? "text-sky-300" :
    e.kind === "tool_result" || e.kind === "command" ? "text-white/45" :
    e.kind === "error" ? "text-red-300" : "text-white/30";
}

function EventRow({ e }: { e: ArenaEvent }) {
  const [open, setOpen] = useState(false);
  return (
    <div>
      <button
        className={`${eventColor(e)} w-full cursor-pointer truncate text-left font-mono text-xs leading-5`}
        title="点击展开详情"
        onClick={() => setOpen(!open)}
      >
        {eventSummary(e)}
      </button>
      {open && (
        <div className="max-h-48 overflow-auto rounded-xl border border-white/10 bg-black/40 p-2 font-mono text-xs break-all whitespace-pre-wrap text-white/70">
          {eventFull(e)}
        </div>
      )}
    </div>
  );
}

// 轨迹时间线：事件流入时自动滚动到底部；用户上滚即暂停跟随，可一键回到最新；支持按事件类型过滤
export default function TrajectoryView({ events }: { events: ArenaEvent[] }) {
  const GROUPS: { key: string; label: string; kinds: string[] }[] = [
    { key: "all", label: "全部", kinds: [] },
    { key: "msg", label: "消息", kinds: ["message"] },
    { key: "think", label: "思考", kinds: ["thinking"] },
    { key: "tool", label: "工具", kinds: ["tool_call", "tool_result", "command"] },
    { key: "file", label: "文件", kinds: ["file_edit"] },
    { key: "err", label: "异常", kinds: ["error", "system"] },
  ];
  const boxRef = useRef<HTMLDivElement>(null);
  const [follow, setFollow] = useState(true);
  const [group, setGroup] = useState("all");
  const shown = group === "all" ? events : events.filter((e) => GROUPS.find((g) => g.key === group)!.kinds.includes(e.kind));

  useEffect(() => {
    if (follow && boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight;
  }, [shown.length, follow]);

  const onScroll = () => {
    const el = boxRef.current;
    if (!el) return;
    setFollow(el.scrollHeight - el.scrollTop - el.clientHeight < 48);
  };

  return (
    <div className="relative space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {GROUPS.map((g) => (
          <button
            key={g.key}
            className={`cursor-pointer rounded-full px-2 py-0.5 text-[10px] transition-colors duration-200 ${group === g.key ? "bg-sky-400/20 text-sky-300" : "bg-white/5 text-white/50 hover:bg-white/10 hover:text-white"}`}
            onClick={() => setGroup(g.key)}
          >
            {g.label}
          </button>
        ))}
      </div>
      <div
        ref={boxRef}
        onScroll={onScroll}
        className="h-48 space-y-0.5 overflow-y-auto rounded-2xl border border-white/10 bg-black/40 p-2.5 shadow-inner"
      >
        {shown.length === 0 && <div className="text-xs text-white/30">等待事件…</div>}
        {shown.map((e, i) => <EventRow key={i} e={e} />)}
      </div>
      {!follow && (
        <button
          onClick={() => { setFollow(true); if (boxRef.current) boxRef.current.scrollTop = boxRef.current.scrollHeight; }}
          className="absolute right-3 bottom-3 cursor-pointer rounded-full bg-sky-500/80 px-2.5 py-1 text-[10px] font-medium text-white shadow-lg shadow-sky-500/25"
        >
          ↓ 回到最新
        </button>
      )}
    </div>
  );
}
