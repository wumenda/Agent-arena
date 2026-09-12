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
      <textarea
        className="w-full border rounded p-3 font-mono text-sm"
        rows={5}
        placeholder="任务提示词，如：写一个贪吃蛇游戏，单文件 HTML"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
      />
      <div className="space-y-2">
        {combos.map((c, i) => (
          <div key={i} className="flex items-center gap-2">
            <ModelSelect value={c} onChange={(v) => setCombos(combos.map((x, j) => (j === i ? v : x)))} />
            <button className="text-red-500" onClick={() => setCombos(combos.filter((_, j) => j !== i))}>删除</button>
          </div>
        ))}
        <button className="border rounded px-3 py-1 text-sm" onClick={() => setCombos([...combos, { harness: "opencode", model: "ark/glm-5.2" }])}>+ 添加组合</button>
      </div>
      <div className="text-sm text-gray-600">
        预估成本：${est.low} – ${est.high}（{combos.length} 个组合并行，单运行超时 15 分钟）
      </div>
      <button
        className="bg-blue-600 text-white rounded px-4 py-2 disabled:opacity-50"
        disabled={!prompt.trim() || combos.length === 0 || submitting}
        onClick={start}
      >
        {submitting ? "启动中…" : "确认开跑"}
      </button>
    </div>
  );
}
