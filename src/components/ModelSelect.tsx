"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { HARNESS_CATALOG } from "@/lib/arena/catalog";

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

const ITEM = "flex w-full cursor-pointer items-center justify-between gap-3 rounded-xl px-3 py-1.5 text-left text-sm text-white/70 transition-colors duration-150 hover:bg-white/10 hover:text-white";

export default function ModelSelect({
  value, onChange, modelsByHarness, onRefreshModels,
}: {
  value: { harness: string; model: string };
  onChange: (v: { harness: string; model: string }) => void;
  modelsByHarness?: Record<string, string[]>;
  onRefreshModels?: () => void;
}) {
  // 同一时间只开一个菜单（harness 或 model）
  const [openMenu, setOpenMenu] = useState<"harness" | "model" | null>(null);
  const wrap = useRef<HTMLDivElement>(null);
  const current = HARNESS_CATALOG.find((a) => a.id === value.harness);
  // 只允许选择本地已配置（探测到）的模型；探测不到 = 未配置
  const models = modelsByHarness?.[value.harness] ?? [];
  const configured = models.length > 0;

  // 点击外部 / Escape 关闭菜单
  useEffect(() => {
    if (!openMenu) return;
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpenMenu(null);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpenMenu(null);
    };
    window.addEventListener("pointerdown", onDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [openMenu]);

  const popover = (children: React.ReactNode, className?: string) => (
    <motion.ul
      initial={{ opacity: 0, y: -6, scale: 0.97 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      exit={{ opacity: 0, y: -4, scale: 0.98, transition: { duration: 0.12 } }}
      className={`glass-popover absolute left-0 top-full z-20 mt-2 overflow-hidden rounded-2xl p-1.5 ${className ?? ""}`}
    >
      {children}
    </motion.ul>
  );

  return (
    <div ref={wrap} className="relative flex flex-1 gap-2">
      {/* harness 下拉 */}
      <div className="relative shrink-0">
        <button
          type="button"
          className={`glass-input flex cursor-pointer items-center gap-2 rounded-xl px-2.5 py-1.5 text-sm text-white/90 transition-colors duration-200 hover:bg-white/10 ${openMenu === "harness" ? "border-sky-400/50" : ""}`}
          onClick={() => setOpenMenu(openMenu === "harness" ? null : "harness")}
        >
          {current?.displayName ?? value.harness}
          <Chevron open={openMenu === "harness"} />
        </button>
        <AnimatePresence>
          {openMenu === "harness" &&
            popover(
              HARNESS_CATALOG.map((a) => (
                <li key={a.id}>
                  <button
                    type="button"
                    className={ITEM}
                    onClick={() => {
                      // 切换 harness 时带出该 harness 本地配置的首个模型（未配置则置空，由校验拦截开跑）
                      const first = (modelsByHarness?.[a.id] ?? [])[0] ?? "";
                      onChange({ harness: a.id, model: first });
                      setOpenMenu("model");
                    }}
                  >
                    {a.displayName}
                    {a.id === value.harness && <Check />}
                  </button>
                </li>
              )),
              "w-44"
            )}
        </AnimatePresence>
      </div>

      {/* 模型下拉：仅本地已配置模型可选 */}
      <div className="relative min-w-0 flex-1">
        <button
          type="button"
          title={configured ? value.model : `${current?.displayName ?? value.harness} 未在本地配置模型`}
          className={`glass-input flex w-full items-center justify-between gap-2 rounded-xl px-2.5 py-1.5 text-left transition-colors duration-200 hover:bg-white/10 ${openMenu === "model" ? "border-sky-400/50" : ""} ${configured ? "cursor-pointer" : "cursor-not-allowed"}`}
          onClick={() => setOpenMenu(openMenu === "model" ? null : "model")}
        >
          <span
            className={`truncate font-mono text-sm ${value.model ? "text-white/90" : "text-amber-300/90"}`}
          >
            {value.model || (configured ? "选择模型" : "未配置")}
          </span>
          <Chevron open={openMenu === "model"} />
        </button>
        <AnimatePresence>
          {openMenu === "model" &&
            (configured ? (
              popover(
                models.map((m) => (
                  <li key={m}>
                    <button
                      type="button"
                      className={ITEM}
                      onClick={() => {
                        onChange({ ...value, model: m });
                        setOpenMenu(null);
                      }}
                    >
                      <span className="truncate font-mono text-xs">{m}</span>
                      {m === value.model && <Check />}
                    </button>
                  </li>
                )),
                "w-full min-w-48"
              )
            ) : (
              // 未配置：提示先去本地配置，支持重新探测
              popover(
                <li className="px-3 py-2.5">
                  <div className="text-xs leading-5 text-white/70">
                    {current?.displayName ?? value.harness} 未检测到本地模型配置
                  </div>
                  <div className="mt-0.5 text-xs leading-5 text-white/40">
                    请先完成该 CLI 的登录/配置，配置文件中的模型会自动出现在这里
                  </div>
                  {onRefreshModels && (
                    <button
                      type="button"
                      className="mt-2 cursor-pointer rounded-full bg-[#0a84ff] px-3 py-1 text-xs font-medium text-white shadow shadow-sky-500/25 transition-colors duration-200 hover:bg-[#409cff]"
                      onClick={onRefreshModels}
                    >
                      配置好了，重新探测
                    </button>
                  )}
                </li>,
                "w-full min-w-56"
              )
            ))}
        </AnimatePresence>
      </div>
    </div>
  );
}
