"use client";
import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AnimatePresence, motion } from "motion/react";
import GlassSelect from "@/components/GlassSelect";

type MatchRow = { id: string; prompt: string; combos: string; status: string; createdAt: string };

// 分页大小：历史页按页拉取，"加载更多"追加下一页
const PAGE_SIZE = 50;

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-white/10 text-white/60",
  running: "bg-sky-400/15 text-sky-300",
  completed: "bg-emerald-400/15 text-emerald-300",
  failed: "bg-red-400/15 text-red-300",
  timeout: "bg-amber-400/15 text-amber-300",
};

export default function HistoryPage() {
  const [matches, setMatches] = useState<MatchRow[]>([]);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("all");
  const [harness, setHarness] = useState("all");
  const [deleting, setDeleting] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);

  // offset=0 首屏加载 / 追加下一页（loadMore 用；首屏与轮询刷新走下方 effect 内联版）
  const load = async (offset: number) => {
    const res = await fetch(`/api/matches?limit=${PAGE_SIZE}&offset=${offset}`);
    const d = await res.json();
    setMatches((prev) => (offset === 0 ? d.matches ?? [] : [...prev, ...(d.matches ?? [])]));
    setHasMore(!!d.hasMore);
  };

  // 首屏 + 5s 轮询：running 对局状态不停留在快照（本地工具，简单轮询即可，不必上 SSE）。
  // 刷新逻辑内联而非复用 load：react-hooks/set-state-in-effect 规则要求 setState 位于 promise 回调
  useEffect(() => {
    const refresh = () => {
      fetch(`/api/matches?limit=${PAGE_SIZE}&offset=0`)
        .then((r) => r.json())
        .then((d) => {
          setMatches(d.matches ?? []);
          setHasMore(!!d.hasMore);
        })
        .catch(() => {});
    };
    refresh();
    const t = setInterval(refresh, 5000);
    return () => clearInterval(t);
  }, []);

  const loadMore = async () => {
    setLoadingMore(true);
    try {
      await load(matches.length);
    } finally {
      setLoadingMore(false);
    }
  };

  const remove = async (mid: string) => {
    if (!confirm("删除该对局？轨迹文件将一并清除。")) return;
    setDeleting(mid);
    const res = await fetch(`/api/matches/${mid}`, { method: "DELETE" });
    setDeleting(null);
    if (res.ok) setMatches((prev) => prev.filter((m) => m.id !== mid));
  };

  // 批量清理：删除所有非运行中的对局（循环单删接口，接口自带 running 校验）
  const [clearing, setClearing] = useState(false);
  const clearFinished = async () => {
    const done = matches.filter((m) => m.status !== "running" && m.status !== "pending");
    if (!done.length) return;
    if (!confirm(`删除 ${done.length} 个已结束对局？轨迹文件将一并清除。`)) return;
    setClearing(true);
    try {
      for (const m of done) {
        await fetch(`/api/matches/${m.id}`, { method: "DELETE" });
      }
      setMatches((prev) => prev.filter((m) => m.status === "running" || m.status === "pending"));
    } finally {
      setClearing(false);
    }
  };

  const harnessOptions = useMemo(
    () => [...new Set(matches.flatMap((m) => JSON.parse(m.combos).map((c: { harness: string }) => c.harness)))].sort(),
    [matches]
  );

  const filtered = useMemo(() => matches.filter((m) =>
    (status === "all" || m.status === status) &&
    (harness === "all" || JSON.parse(m.combos).some((c: { harness: string }) => c.harness === harness)) &&
    (q === "" || m.prompt.toLowerCase().includes(q.toLowerCase()) || m.id.includes(q))
  ), [matches, q, status, harness]);

  return (
    <main className="mx-auto w-full max-w-4xl space-y-4 p-8">
      <motion.h1
        initial={{ opacity: 0, y: 18 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: "easeOut" }}
        className="text-2xl font-bold tracking-tight text-white/90"
      >
        历史对局
      </motion.h1>
      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.06, duration: 0.35, ease: "easeOut" }}
        className="glass relative z-10 flex flex-wrap items-center gap-2 rounded-full p-2"
      >
        <input
          className="glass-input min-w-40 flex-1 rounded-full px-3 py-1.5 text-xs text-white/85 outline-none placeholder-white/30"
          placeholder="搜索 prompt 或对局 id…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <GlassSelect
          compact
          value={status}
          onChange={setStatus}
          items={[
            { value: "all", label: "全部状态" },
            ...["pending", "running", "completed", "partial"].map((s) => ({ value: s, label: s })),
          ]}
        />
        <GlassSelect
          compact
          value={harness}
          onChange={setHarness}
          items={[
            { value: "all", label: "全部 harness" },
            ...harnessOptions.map((h) => ({ value: h, label: h })),
          ]}
        />
        <span className="px-2 text-xs whitespace-nowrap text-white/40">{filtered.length} / {matches.length}</span>
        <button
          className="cursor-pointer rounded-full bg-white/5 px-3 py-1.5 text-xs text-white/50 hover:bg-red-400/20 hover:text-red-300 disabled:opacity-40"
          title="删除全部已结束对局（释放 workdir 磁盘空间）"
          disabled={clearing || matches.every((m) => m.status === "running" || m.status === "pending")}
          onClick={clearFinished}
        >
          {clearing ? "清理中…" : "清理已结束"}
        </button>
      </motion.div>
      {filtered.length === 0 && (
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.12, duration: 0.35, ease: "easeOut" }}
          className="glass rounded-3xl p-8 text-center text-sm text-white/40"
        >
          {matches.length === 0 ? "还没有对局" : "没有匹配的对局"}
        </motion.div>
      )}
      <div className="space-y-3">
        <AnimatePresence mode="popLayout">
          {filtered.map((m, i) => (
            <motion.div
              key={m.id}
              layout
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0, transition: { delay: Math.min(i * 0.04, 0.4), duration: 0.3, ease: "easeOut" } }}
              exit={{ opacity: 0, scale: 0.96, transition: { duration: 0.15 } }}
              className="relative group"
            >
            <Link
              href={`/match/${m.id}`}
              className="glass block cursor-pointer rounded-3xl p-4 pr-10"
            >
              <div className="flex items-center gap-2 font-mono text-xs text-white/35">
                <span className="truncate">{m.id}</span>
                <span className={`shrink-0 rounded-full px-2 py-0.5 ${STATUS_STYLE[m.status] ?? "bg-white/10 text-white/60"}`}>
                  {m.status}
                </span>
                <span className="shrink-0">{new Date(m.createdAt).toLocaleString()}</span>
              </div>
              <div className="mt-1.5 truncate text-sm text-white/85">{m.prompt}</div>
              <div className="mt-1 text-xs text-white/40">
                {JSON.parse(m.combos).map((c: { harness: string; model: string }) => `${c.harness}×${c.model}`).join("，")}
              </div>
            </Link>
            {/* 悬停提亮：玻璃元素的兄弟遮罩层（勿放进玻璃元素内部——会触发 Chromium 逐帧重滤波导致底部闪烁） */}
            <span
              aria-hidden
              className="pointer-events-none absolute inset-0 rounded-3xl bg-white/5 opacity-0 transition-opacity duration-200 group-hover:opacity-100"
            />
            <button
              className="absolute top-3 right-3 cursor-pointer rounded-full bg-white/10 px-2 py-0.5 text-xs text-white/50 hover:bg-red-400/20 hover:text-red-300 disabled:opacity-40"
              title="删除对局"
              disabled={deleting === m.id}
              onClick={(e) => { e.preventDefault(); e.stopPropagation(); remove(m.id); }}
            >
              {deleting === m.id ? "…" : "✕"}
            </button>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      {hasMore && (
        <button
          className="glass mx-auto block cursor-pointer rounded-full px-6 py-2 text-sm text-white/70 hover:bg-white/10 hover:text-white disabled:opacity-40"
          disabled={loadingMore}
          onClick={loadMore}
        >
          {loadingMore ? "加载中…" : "加载更多"}
        </button>
      )}
    </main>
  );
}
