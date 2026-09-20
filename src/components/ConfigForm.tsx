"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import ModelSelect from "./ModelSelect";
import GlassSelect from "./GlassSelect";
import { estimateCost, estimateCostFromHistory, type ComboHistoryStat } from "@/lib/arena/estimator";
import type { Combo, MatchConfig } from "@/lib/arena/types";
import type { BankSummary } from "@/lib/arena/questions";

// 组合行加稳定 id，供 AnimatePresence 追踪增删
type ComboRow = { id: number; harness: string; model: string };

// API 错误兼容两种形态：zod flatten 对象（{ formErrors, fieldErrors } 或 { 字段: [消息] }）与普通字符串
function formatError(data: unknown, status: number): string {
  const err = (data as { error?: unknown } | null)?.error;
  if (typeof err === "string" && err) return err;
  if (err && typeof err === "object") {
    const parts: string[] = [];
    for (const [field, msgs] of Object.entries(err as Record<string, unknown>)) {
      if (Array.isArray(msgs)) {
        for (const m of msgs) parts.push(typeof m === "string" ? (field === "formErrors" ? m : `${field}: ${m}`) : String(m));
      }
    }
    if (parts.length) return parts.join("；");
  }
  return `创建对局失败（HTTP ${status}）`;
}

// 快捷模板：combos 为纯配置（无 id），填充时经 nextId 生成 ComboRow
const TEMPLATES: { name: string; combos: { harness: string; model: string }[] }[] = [
  { name: "三 harness 全对比", combos: [{ harness: "claude-code", model: "glm-5.3-flash" }, { harness: "codex", model: "glm-5.3-flash" }, { harness: "opencode", model: "agentplan/glm-5.3-flash" }] },
  { name: "双雄对决", combos: [{ harness: "claude-code", model: "glm-5.3-flash" }, { harness: "codex", model: "glm-5.3-flash" }] },
  { name: "单跑 OpenCode", combos: [{ harness: "opencode", model: "agentplan/glm-5.3-flash" }] },
];

export default function ConfigForm({ initial, modelsByHarness, onRefreshModels }: {
  initial?: MatchConfig | null;
  modelsByHarness?: Record<string, string[]>;
  onRefreshModels?: () => void;
}) {
  const router = useRouter();
  const initialCombos = initial?.combos ?? [{ harness: "claude-code", model: "sonnet" }];
  const nextId = useRef(initialCombos.length + 1);
  const [prompt, setPrompt] = useState(initial?.prompt ?? "");
  const [banks, setBanks] = useState<BankSummary[]>([]);
  const [bankId, setBankId] = useState(initial?.question?.bank ?? "");
  const [questionId, setQuestionId] = useState(initial?.question?.id ?? "");
  const [combos, setCombos] = useState<ComboRow[]>(
    initialCombos.map((c, i) => ({ ...c, id: i + 1 }))
  );
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  // 单运行超时（分钟，空=用全局 ARENA_TIMEOUT_MS）
  const [timeoutMinutes, setTimeoutMinutes] = useState<number | null>(initial?.timeoutMinutes ?? null);
  // 组合历史实测均值：加载后估算从 tier 区间升级为 tokens×单价 精算
  const [history, setHistory] = useState<ComboHistoryStat[]>([]);
  useEffect(() => {
    fetch("/api/stats").then((r) => r.json()).then((d) => setHistory(d.stats ?? [])).catch(() => {});
  }, []);
  const histEst = estimateCostFromHistory(combos as Combo[], history);
  const est = histEst.precise === combos.length ? { low: histEst.low, high: histEst.high } : estimateCost(combos as Combo[]);
  const allPrecise = combos.length > 0 && histEst.precise === combos.length;
  // 模型只能从本地已配置列表选择；存在未选模型的组合时拦截开跑
  const missingModel = combos.some((c) => !c.model.trim());
  const bank = banks.find((b) => b.id === bankId);
  const question = bank?.questions.find((q) => q.id === questionId);

  // 题库列表：内置题库 + 用户自放题库（.arena/questions），挂载加载一次
  useEffect(() => {
    fetch("/api/questions")
      .then((r) => r.json())
      .then((d) => setBanks(d.banks ?? []))
      .catch(() => {});
  }, []);

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
    setError("");
    try {
      const res = await fetch("/api/matches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prompt,
          combos: combos.map(({ harness, model }) => ({ harness, model })),
          ...(bankId && questionId ? { question: { bank: bankId, id: questionId } } : {}),
          ...(timeoutMinutes != null ? { timeoutMinutes } : {}),
        }),
      });
      const data = await res.json().catch(() => null);
      if (!res.ok || !data?.match?.id) {
        setError(formatError(data, res.status));
        return;
      }
      // prompt 历史：去重、限 10 条，通知首页 chips 刷新
      try {
        const hist = JSON.parse(localStorage.getItem("arena.promptHistory") ?? "[]") as string[];
        const next = [prompt, ...hist.filter((p) => p !== prompt)].slice(0, 10);
        localStorage.setItem("arena.promptHistory", JSON.stringify(next));
        window.dispatchEvent(new Event("arena:prompt-history"));
      } catch {}
      router.push(`/match/${data.match.id}`);
    } catch {
      setError("网络异常：无法连接本地服务，请确认 dev 服务仍在运行");
    } finally {
      setSubmitting(false);
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
      <div className="space-y-1.5">
        <div className="flex gap-2">
          <GlassSelect
            className="min-w-0 flex-1"
            value={bankId}
            onChange={(v) => { setBankId(v); setQuestionId(""); }}
            items={[
              { value: "", label: "不使用题库（自由任务）" },
              ...(["builtin", "user"] as const).flatMap((src) => {
                const group = banks.filter((b) => b.source === src);
                return group.length
                  ? [{
                      label: src === "builtin" ? "内置题库" : "我的题库",
                      options: group.map((b) => ({ value: b.id, label: `${b.name}（${b.questions.length} 题）` })),
                    }]
                  : [];
              }),
            ]}
          />
          <GlassSelect
            className="min-w-0 flex-1"
            value={questionId}
            disabled={!bank}
            onChange={(v) => {
              const q = bank?.questions.find((x) => x.id === v);
              setQuestionId(v);
              if (q?.prompt) setPrompt(q.prompt); // 题目自带任务描述：直接填入提示词，仍可编辑
            }}
            items={[
              { value: "", label: bank ? "选择一道题…" : "先选题库" },
              ...(bank?.questions.map((q) => ({
                value: q.id,
                label: `${q.title}（${q.hasTest ? "带测试" : "无测试"}）`,
              })) ?? []),
            ]}
          />
        </div>
        {question && (
          <div className="text-xs text-white/50">
            {question.description && <span>{question.description} </span>}
            <span className="text-white/30">{question.hasTest ? "自带测试套件，跑完自动验证修复" : "无自动化测试，对比产出与轨迹"}</span>
          </div>
        )}
        <div className="text-xs text-white/30">
          自定义题库：把题目放进 <span className="font-mono">.arena/questions/题库/题目/</span>（题目目录即项目，可附 question.json 写说明与提示词），刷新页面即可选择
        </div>
      </div>
      <div className="space-y-2">
        <AnimatePresence initial={false}>
          {combos.map((c, i) => (
            <motion.div
              key={c.id}
              layout
              initial={{ opacity: 0, y: -10, scale: 0.97 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95, transition: { duration: 0.15 } }}
              className="glass relative flex items-center gap-2 rounded-2xl p-2"
              style={{ zIndex: combos.length - i }}
            >
              <ModelSelect
                value={c}
                modelsByHarness={modelsByHarness}
                onRefreshModels={onRefreshModels}
                onChange={(v) => setCombos(combos.map((x) => (x.id === c.id ? { ...x, ...v } : x)))}
              />
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
          className="glass cursor-pointer rounded-full px-4 py-1.5 text-sm text-white/70 hover:bg-white/10 hover:text-white"
          onClick={() => setCombos([...combos, { id: nextId.current++, harness: "opencode", model: "agentplan/glm-5.3-flash" }])}
        >
          + 添加组合
        </motion.button>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-white/50">
        <span>
          预估成本：<span className="font-mono text-white/80">${est.low}{est.low === est.high ? "" : ` – $${est.high}`}</span>
          （{combos.length} 个组合并行{allPrecise ? "，按同组合历史实测 token 均值精算" : "，按模型档位粗估"}）
        </span>
        <label className="flex items-center gap-1.5 text-xs text-white/40">
          单运行超时
          <input
            type="number"
            min={1}
            max={120}
            className="glass-input w-16 rounded-lg px-2 py-1 text-center font-mono text-xs text-white/85 outline-none"
            value={timeoutMinutes ?? ""}
            placeholder="15"
            onChange={(e) => {
              const n = Number(e.target.value);
              setTimeoutMinutes(Number.isFinite(n) && n > 0 ? n : null);
            }}
          />
          分钟（空=默认）
        </label>
      </div>
      {missingModel && (
        <div className="text-xs text-amber-300/90">
          有组合尚未选择模型：请在该 harness 完成本地登录/配置后，从模型下拉选择（或点「重新探测」）
        </div>
      )}
      {error && (
        <div className="rounded-xl border border-red-400/30 bg-red-400/10 px-3 py-2 text-xs text-red-300">
          {error}
        </div>
      )}
      <motion.button
        whileTap={{ scale: 0.96 }}
        className="flex cursor-pointer items-center gap-2 rounded-full bg-[#0a84ff] px-6 py-2 font-medium text-white shadow-lg shadow-sky-500/25 transition-colors duration-200 hover:bg-[#409cff] disabled:cursor-not-allowed disabled:opacity-40"
        disabled={!prompt.trim() || combos.length === 0 || missingModel || submitting}
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
