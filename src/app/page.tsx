"use client";
import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import ConfigForm from "@/components/ConfigForm";
import type { MatchConfig } from "@/lib/arena/types";

export default function Home() {
  const [input, setInput] = useState("");
  const [parsing, setParsing] = useState(false);
  const [config, setConfig] = useState<MatchConfig | null>(null);
  // 解析成功次数：作为 ConfigForm 的 key，强制以新 initial 重新挂载（useState 初始值只在挂载时生效）
  const [configSeq, setConfigSeq] = useState(0);
  const [parseError, setParseError] = useState("");
  const [detect, setDetect] = useState<{ harness: string; installed: boolean; detail: string; models?: string[] }[]>([]);
  const [history, setHistory] = useState<string[]>([]);

  // 探测 harness 安装状态与本地可用模型；force 绕过服务端 30s 缓存（「重新探测」按钮用）
  const refreshDetect = (force = false) => {
    fetch(`/api/detect${force ? "?force=1" : ""}`).then((r) => r.json()).then((d) => setDetect(d.results ?? []));
  };

  useEffect(() => {
    refreshDetect();
  }, []);

  // prompt 历史：挂载加载一次 + ConfigForm 开跑后经事件刷新
  useEffect(() => {
    const load = () => {
      try {
        setHistory(JSON.parse(localStorage.getItem("arena.promptHistory") ?? "[]") as string[]);
      } catch {}
    };
    load();
    window.addEventListener("arena:prompt-history", load);
    return () => window.removeEventListener("arena:prompt-history", load);
  }, []);

  // 探测到的各 harness 动态模型列表（detect 失败的 harness 由 ModelSelect 回退静态目录）
  const modelsByHarness = Object.fromEntries(
    detect.filter((d) => d.models?.length).map((d) => [d.harness, d.models!])
  );

  const parse = async () => {
    setParsing(true);
    setParseError("");
    const res = await fetch("/api/parse", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ input }),
    });
    const data = await res.json();
    setParsing(false);
    if (res.ok && data.config) {
      setConfig(data.config);
      setConfigSeq((s) => s + 1);
    } else setParseError(data.error ?? "解析失败，请手动配置");
  };

  return (
    <main className="mx-auto w-full max-w-3xl space-y-6 p-8">
      {/* Hero：交错入场 */}
      <div className="space-y-2 pt-4 text-center">
        <motion.h1
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          className="bg-gradient-to-b from-white to-white/60 bg-clip-text text-4xl font-bold tracking-tight text-transparent"
        >
          Agent 竞技场
        </motion.h1>
        <motion.p
          initial={{ opacity: 0, y: 14 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
          className="text-sm text-white/50"
        >
          一句话发起对局，多个 harness 同场编程，实时对比轨迹、指标与产出
        </motion.p>
      </div>

      {/* harness 探测状态：逐个弹入 */}
      <div className="flex flex-wrap items-center justify-center gap-2">
        {detect.map((d, i) => (
          <motion.span
            key={d.harness}
            title={d.detail}
            initial={{ opacity: 0, scale: 0.85 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ delay: 0.15 + i * 0.06 }}
            className="glass flex items-center gap-1.5 rounded-full px-3 py-1 text-xs text-white/70"
          >
            <span
              className={`inline-block size-1.5 rounded-full ${
                d.installed
                  ? "bg-emerald-400 shadow-[0_0_6px_rgba(52,211,153,0.9)]"
                  : "bg-red-400/70"
              }`}
            />
            {d.harness}
          </motion.span>
        ))}
      </div>

      {/* 一句话解析 */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.12 }}
        className="glass-strong space-y-3 rounded-3xl p-5"
      >
        <div className="text-xs font-medium tracking-wide text-white/40 uppercase">一句话创建对局</div>
        <textarea
          className="glass-input w-full rounded-2xl p-3 text-sm text-white/90 placeholder-white/30 transition focus:border-sky-400/50 focus:ring-2 focus:ring-sky-400/20 focus:outline-none"
          rows={2}
          placeholder="一句话描述对比，如：对比 claude code 和 codex 写一个贪吃蛇"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        {history.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-xs text-white/40">最近：</span>
            {history.slice(0, 5).map((p) => (
              <button
                key={p}
                title={p}
                className="glass-input max-w-56 cursor-pointer truncate rounded-full px-2.5 py-0.5 text-xs text-white/60 hover:text-white"
                onClick={() => setInput(p)}
              >
                {p}
              </button>
            ))}
          </div>
        )}
        <div className="flex items-center gap-3">
          <motion.button
            whileTap={{ scale: 0.95 }}
            className="flex cursor-pointer items-center gap-2 rounded-full bg-[#0a84ff] px-5 py-1.5 text-sm font-medium text-white shadow-lg shadow-sky-500/25 transition-colors duration-200 hover:bg-[#409cff] disabled:cursor-not-allowed disabled:opacity-40"
            disabled={parsing || !input.trim()}
            onClick={parse}
          >
            {parsing && (
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.5}
                strokeLinecap="round" className="size-3.5 animate-spin" aria-hidden>
                <path d="M21 12a9 9 0 1 1-6.2-8.56" />
              </svg>
            )}
            {parsing ? "解析中…" : "解析"}
          </motion.button>
          <AnimatePresence>
            {parseError && (
              <motion.div
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                exit={{ opacity: 0 }}
                className="text-sm text-red-400"
              >
                {parseError}
              </motion.div>
            )}
          </AnimatePresence>
        </div>
      </motion.section>

      {/* 对局配置（解析结果回显确认，ADR-0004） */}
      <motion.section
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.2 }}
        className="glass-strong rounded-3xl p-5"
      >
        <ConfigForm key={configSeq} initial={config} modelsByHarness={modelsByHarness} onRefreshModels={() => refreshDetect(true)} />
      </motion.section>
    </main>
  );
}
