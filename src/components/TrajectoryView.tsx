"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import type { ArenaEvent } from "@/lib/arena/types";

function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round"
      className={`size-3 shrink-0 transition-transform duration-200 ${open ? "rotate-90" : ""}`} aria-hidden>
      <path d="m9 6 6 6-6 6" />
    </svg>
  );
}

/** 可折叠事件块：标题行 + 全文正文（展开时超长内容内部滚动） */
function Collapsible({ label, tone, body, mono = true, defaultOpen = false }: {
  label: string; tone: string; body: string; mono?: boolean; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div>
      <button
        type="button"
        className={`flex w-full cursor-pointer items-center gap-1.5 text-left ${tone} transition-opacity duration-150 hover:opacity-80`}
        onClick={() => setOpen(!open)}
      >
        <Chevron open={open} />
        <span className="truncate text-xs">{label}</span>
      </button>
      <AnimatePresence initial={false}>
        {open && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18 }}
            className="overflow-hidden"
          >
            <pre
              className={`mt-1 max-h-64 overflow-auto whitespace-pre-wrap break-words rounded-lg bg-black/30 p-2 text-xs leading-5 text-white/70 ${mono ? "font-mono" : ""}`}
            >
              {body}
            </pre>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function EventBlock({ e }: { e: ArenaEvent }) {
  switch (e.kind) {
    case "message":
      // 助手回复：默认全文展开
      return (
        <Collapsible label="回复" tone="text-white/85 font-medium" body={e.text} mono={false} defaultOpen />
      );
    case "thinking":
      return <Collapsible label={`思考（${e.text.length} 字）`} tone="text-violet-300" body={e.text} />;
    case "tool_call":
      return (
        <Collapsible
          label={`调用工具 ${e.tool}`}
          tone="text-sky-300"
          body={(() => {
            try { return JSON.stringify((e as { input?: unknown }).input, null, 2); } catch { return ""; }
          })()}
        />
      );
    case "tool_result":
      return (
        <Collapsible
          label={`工具返回${(e as { isError?: boolean }).isError ? "（出错）" : ""}（${e.output.length} 字）`}
          tone={(e as { isError?: boolean }).isError ? "text-red-300" : "text-emerald-300/80"}
          body={e.output}
        />
      );
    case "command":
      return (
        <div className="font-mono text-xs leading-5 text-white/50">
          <span className="text-amber-300/80">$ </span>
          {e.command}
          {e.exitCode != null && <span className="text-white/30">（退出码 {e.exitCode}）</span>}
        </div>
      );
    case "file_edit":
      return <div className="font-mono text-xs leading-5 text-sky-300">编辑文件 {e.path}</div>;
    case "error":
      return <div className="whitespace-pre-wrap font-mono text-xs leading-5 text-red-300">错误：{e.text}</div>;
    case "done":
      return (
        <div className="font-mono text-xs leading-5 text-emerald-300/80">
          完成{e.usage ? `（tokens ${e.usage.input} → ${e.usage.output}` : ""}{e.costUsd != null ? ` · $${e.costUsd.toFixed(4)}` : ""}{e.usage ? "）" : ""}
        </div>
      );
    default:
      // system 等运行日志：单行弱化，悬停看全文
      return (
        <div className="truncate font-mono text-xs leading-5 text-white/30" title={e.text}>
          [系统] {e.text}
        </div>
      );
  }
}

export default function TrajectoryView({ events }: { events: ArenaEvent[] }) {
  const boxRef = useRef<HTMLDivElement>(null);
  // 系统调试日志（CLI 的 stderr INFO 行、init 通知等）不进对话流：留档于 trajectory.jsonl，真错误以 error 事件上屏
  const visible = events.filter((e) => e.kind !== "system");
  // 新事件到达时自动滚动到底部（用户向上翻阅时不打断）
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const nearBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
    if (nearBottom) el.scrollTop = el.scrollHeight;
  }, [events]);

  return (
    <div ref={boxRef} className="h-96 shrink-0 space-y-1.5 overflow-y-auto rounded-2xl border border-white/10 bg-black/40 p-2.5 shadow-inner">
      {visible.length === 0 && <div className="text-xs text-white/30">等待事件…</div>}
      {visible.map((e, i) => (
        <motion.div
          key={i}
          initial={{ opacity: 0, x: -8 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.2, ease: "easeOut" }}
        >
          <EventBlock e={e} />
        </motion.div>
      ))}
    </div>
  );
}
