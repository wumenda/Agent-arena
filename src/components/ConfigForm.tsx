"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import ModelSelect from "./ModelSelect";
import { estimateCost } from "@/lib/arena/estimator";
import type { Combo, MatchConfig } from "@/lib/arena/types";

// 组合行加稳定 id，供 AnimatePresence 追踪增删
type ComboRow = { id: number; harness: string; model: string };

// 快捷模板：combos 为纯配置（无 id），填充时经 nextId 生成 ComboRow
const TEMPLATES: { name: string; combos: { harness: string; model: string }[] }[] = [
  { name: "三 harness 全对比", combos: [{ harness: "claude-code", model: "glm-5.3-flash" }, { harness: "codex", model: "glm-5.3-flash" }, { harness: "opencode", model: "ark/glm-5.2" }] },
  { name: "双雄对决", combos: [{ harness: "claude-code", model: "glm-5.3-flash" }, { harness: "codex", model: "glm-5.3-flash" }] },
  { name: "单跑 OpenCode", combos: [{ harness: "opencode", model: "ark/glm-5.2" }] },
];

export default function ConfigForm({ initial }: { initial?: MatchConfig | null }) {
  const router = useRouter();
  const initialCombos = initial?.combos ?? [{ harness: "claude-code", model: "sonnet" }];
  const nextId = useRef(initialCombos.length + 1);
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [combos, setCombos] = useState<ComboRow[]>(
    initialCombos.map((c, i) => ({ ...c, id: i + 1 }))
  );
  const [submitting, setSubmitting] = useState(false);
  const est = estimateCost(combos as Combo[]);

  // 配置记忆：挂载时（无 initial 回显才）恢复上次组合；id 重新生成避免与 nextId 冲突
  useEffect(() => {
    if (initial?.combos?.length) return;
    try {
      const saved = JSON.parse(localStorage.getItem("arena.lastCombos") ?? "null") as
        | { harness: string; model: string }[]
        | null;
      if (Array.isArray(saved) && saved.length > 0) {
        setCombos(saved.map((c) => ({ ...c, id: nextId.current++ })));
      }
    } catch {}
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 变更持久化：剥离 id 只存纯配置
  useEffect(() => {
    try {
      localStorage.setItem("arena.lastCombos", JSON.stringify(combos.map(({ harness, model }) => ({ harness, model }))));
    } catch {}
  }, [combos]);

  const start = async () => {
    setSubmitting(true);
    const res = await fetch("/api/matches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, combos: combos.map(({ harness, model }) => ({ harness, model })) }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (res.ok) {
      // prompt 历史：去重、限 10 条，通知首页 chips 刷新
      try {
        const hist = JSON.parse(localStorage.getItem("arena.promptHistory") ?? "[]") as string[];
        const next = [prompt, ...hist.filter((p) => p !== prompt)].slice(0, 10);
        localStorage.setItem("arena.promptHistory", JSON.stringify(next));
        window.dispatchEvent(new Event("arena:prompt-history"));
      } catch {}
      router.push(`/match/${data.match.id}`);
    }
  };

  return (
    <div className="space-y-4">
      <div className="text-xs font-medium tracking-wide text-white/40 uppercase">对局配置</div>
      <textarea
        className="glass-input w-full rounded-2xl p-3 font-mono text-sm text-white/90 placeholder-white/30 transition focus:border-sky-400/50 focus:ring-2 focus:ring-sky-400/20 focus:outline-none"
        rows={5}
        placeholder="任务提示词，如：写一个贪吃蛇游戏，单文件 HTML"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />
      <div className="space-y-2">
        <AnimatePresence initial={false}>
          {combos.map((c) => (
            <motion.div
              key={c.id}
              layout
              initial={{ opacity: 0, y: -10, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
              className="glass flex items-center gap-2 rounded-2xl p-2"
            >
              <ModelSelect value={c} onChange={(v) => setCombos(combos.map((x) => (x.id === c.id ? { ...x, ...v } : x)))} />
              <motion.button
                whileTap={{ scale: 0.92 }}
                className="cursor-pointer rounded-full px-3 py-1 text-sm text-red-400 transition-colors duration-200 hover:bg-red-400/10 hover:text-red-300"
                onClick={() => setCombos(combos.filter((x) => x.id !== c.id))}
              >
                删除
              </motion.button>
            </motion.div>
          ))}
        </AnimatePresence>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-xs text-white/40">模板：</span>
          {TEMPLATES.map((t) => (
            <button
              key={t.name}
              className="glass-input cursor-pointer rounded-full px-2.5 py-0.5 text-xs text-white/70 hover:text-white"
              onClick={() => setCombos(t.combos.map((c) => ({ ...c, id: nextId.current++ })))}
            >
              {t.name}
            </button>
          ))}
        </div>
        <motion.button
          whileTap={{ scale: 0.95 }}
          className="glass cursor-pointer rounded-full px-4 py-1.5 text-sm text-white/70 transition-colors duration-200 hover:bg-white/10 hover:text-white"
          onClick={() => setCombos([...combos, { id: nextId.current++, harness: "opencode", model: "ark/glm-5.2" }])}
        >
          + 添加组合
        </motion.button>
      </div>
      <div className="text-sm text-white/50">
        预估成本：<span className="font-mono text-white/80">${est.low} – ${est.high}</span>
        （{combos.length} 个组合并行，单运行超时 15 分钟）
      </div>
      <motion.button
        whileTap={{ scale: 0.96 }}
        className="flex cursor-pointer items-center gap-2 rounded-full bg-[#0a84ff] px-6 py-2 font-medium text-white shadow-lg shadow-sky-500/25 transition-colors duration-200 hover:bg-[#409cff] disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!prompt.trim() || combos.length === 0 || submitting}
        onClick={start}
      >
        {submitting && (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
            strokeLinecap="round" className="size-4 animate-spin" aria-hidden>
            <path d="M21 12a9 9 0 1 1-6.2-8.56" />
          </svg>
        )}
        {submitting ? "启动中…" : "确认开跑"}
      </motion.button>
    </div>
  );
}
