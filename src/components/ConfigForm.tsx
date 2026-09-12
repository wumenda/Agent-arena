"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import ModelSelect from "./ModelSelect";
import { estimateCost } from "@/lib/arena/estimator";
import type { Combo, MatchConfig } from "@/lib/arena/types";

export default function ConfigForm({ initial }: { initial?: MatchConfig | null }) {
  const router = useRouter();
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [combos, setCombos] = useState<{ harness: string; model: string }[]>(
    initial?.combos ?? [{ harness: "claude-code", model: "sonnet" }]
  );
  const [submitting, setSubmitting] = useState(false);
  const est = estimateCost(combos as Combo[]);

  const start = async () => {
    setSubmitting(true);
    const res = await fetch("/api/matches", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ prompt, combos }),
    });
    const data = await res.json();
    setSubmitting(false);
    if (res.ok) router.push(`/match/${data.match.id}`);
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
        {combos.map((c, i) => (
          <div key={i} className="glass flex items-center gap-2 rounded-2xl p-2">
            <ModelSelect value={c} onChange={(v) => setCombos(combos.map((x, j) => (j === i ? v : x)))} />
            <button
              className="cursor-pointer rounded-full px-3 py-1 text-sm text-red-400 transition-colors duration-200 hover:bg-red-400/10 hover:text-red-300"
              onClick={() => setCombos(combos.filter((_, j) => j !== i))}
            >
              删除
            </button>
          </div>
        ))}
        <button
          className="glass cursor-pointer rounded-full px-4 py-1.5 text-sm text-white/70 transition-colors duration-200 hover:bg-white/10 hover:text-white"
          onClick={() => setCombos([...combos, { harness: "opencode", model: "ark/glm-5.2" }])}
        >
          + 添加组合
        </button>
      </div>
      <div className="text-sm text-white/50">
        预估成本：<span className="font-mono text-white/80">${est.low} – ${est.high}</span>
        （{combos.length} 个组合并行，单运行超时 15 分钟）
      </div>
      <button
        className="cursor-pointer rounded-full bg-[#0a84ff] px-6 py-2 font-medium text-white shadow-lg shadow-sky-500/25 transition-colors duration-200 hover:bg-[#409cff] disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!prompt.trim() || combos.length === 0 || submitting}
        onClick={start}
      >
        {submitting ? "启动中…" : "确认开跑"}
      </button>
    </div>
  );
}
