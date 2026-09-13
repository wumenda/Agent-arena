"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";

// 通用玻璃下拉：替代原生 <select>，弹层样式与全站玻璃主题一致
export type GlassSelectOption = { value: string; label: string };
// 分组项等价于原生 optgroup；用 options 字段区分普通选项
export type GlassSelectItem = GlassSelectOption | { label: string; options: GlassSelectOption[] };

function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2}
      strokeLinecap="round" strokeLinejoin="round"
      className={`size-3.5 shrink-0 opacity-60 transition-transform duration-200 ${open ? "rotate-180" : ""}`} aria-hidden>
      <path d="m6 9 6 6 6-6" />
    </svg>
  );
}

function Check() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
      strokeLinecap="round" strokeLinejoin="round" className="size-3.5 shrink-0 text-sky-300" aria-hidden>
      <path d="M20 6 9 17l-5-5" />
    </svg>
  );
}

const itemClass = (compact: boolean) =>
  `flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-1.5 text-left text-white/70 transition-colors duration-150 hover:bg-white/10 hover:text-white ${compact ? "text-xs" : "text-sm"}`;

export default function GlassSelect({
  value, onChange, items, disabled, className, compact, align = "left",
}: {
  value: string;
  onChange: (v: string) => void;
  items: GlassSelectItem[];
  disabled?: boolean;
  className?: string;
  // 紧凑模式：胶囊小号触发器，适配工具栏场景
  compact?: boolean;
  // 弹层对齐方向：靠右的工具栏用 right 防溢出
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);

  // 点击外部 / Escape 关闭菜单
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  // 触发按钮回显当前值对应的文案
  const currentLabel = (() => {
    for (const item of items) {
      if ("options" in item) {
        const hit = item.options.find((o) => o.value === value);
        if (hit) return hit.label;
      } else if (item.value === value) {
        return item.label;
      }
    }
    return "";
  })();

  const optionButton = (o: GlassSelectOption) => (
    <li key={o.value}>
      <button
        type="button"
        className={itemClass(!!compact)}
        onClick={() => {
          onChange(o.value);
          setOpen(false);
        }}
      >
        <span className="truncate">{o.label}</span>
        {o.value === value && <Check />}
      </button>
    </li>
  );

  return (
    <div ref={wrap} className={`relative ${open ? "z-30" : ""} ${className ?? ""}`}>
      <button
        type="button"
        disabled={disabled}
        className={`glass-input flex w-full cursor-pointer items-center justify-between gap-2 text-left text-white/90 transition-colors duration-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40 ${compact ? "rounded-full px-3 py-1.5 text-xs" : "rounded-xl px-3 py-2 text-sm"} ${open ? "border-sky-400/50" : ""}`}
        onClick={() => setOpen(!open)}
      >
        <span className="truncate">{currentLabel}</span>
        <Chevron open={open} />
      </button>
      <AnimatePresence>
        {open && (
          <motion.ul
            initial={{ opacity: 0, y: -6, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.12 } }}
            className={`glass-popover absolute top-full z-20 mt-2 max-h-64 w-full min-w-48 overflow-y-auto rounded-2xl p-1.5 ${align === "right" ? "right-0" : "left-0"}`}
          >
            {items.map((item, i) =>
              "options" in item ? (
                <li key={`group-${i}`}>
                  <div className="px-3 pt-2 pb-1 text-xs font-medium text-white/40">{item.label}</div>
                  <ul>{item.options.map(optionButton)}</ul>
                </li>
              ) : (
                optionButton(item)
              )
            )}
          </motion.ul>
        )}
      </AnimatePresence>
    </div>
  );
}
