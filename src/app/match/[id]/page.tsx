"use client";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import RunPanel from "@/components/RunPanel";
import RunDiff from "@/components/RunDiff";
import ComparisonTable from "@/components/ComparisonTable";
import PreviewGrid from "@/components/PreviewGrid";
import type { ArenaEvent } from "@/lib/arena/types";
import type { RunDTO } from "@/lib/db/schema";

const STATUS_STYLE: Record<string, string> = {
  pending: "bg-white/10 text-white/60",
  running: "bg-sky-400/15 text-sky-300 animate-pulse",
  completed: "bg-emerald-400/15 text-emerald-300",
  failed: "bg-red-400/15 text-red-300",
  timeout: "bg-amber-400/15 text-amber-300",
};

export default function MatchPage() {
  const { id } = useParams<{ id: string }>();
  const [runs, setRuns] = useState<RunDTO[]>([]);
  const [events, setEvents] = useState<Record<string, ArenaEvent[]>>({});
  const [matchStatus, setMatchStatus] = useState("…");
  const [showDiff, setShowDiff] = useState(false);
  // 卡片 tab 当前聚焦项：点击 tab 高亮并滚动到对应卡片
  const [activeRunId, setActiveRunId] = useState<string | null>(null);
  // 重跑后原地刷新：重挂数据流（重新拉 runs + 重连 SSE），不再跳转新对局页
  const [reloadTick, setReloadTick] = useState(0);
  // 通知权限只在客户端读取（服务端无 Notification），挂载后微任务中同步一次，避免水合不一致
  const [notifyPermission, setNotifyPermission] = useState<NotificationPermission | null>(null);
  // SSE 连接状态：断流时提示用户（轮询兜底仍在，但实时性下降）
  const [sseConnected, setSseConnected] = useState<boolean | null>(null);
  // 预览刷新信号：run-event 出现文件产物类事件时递增，PreviewGrid 据此重拉文件清单（替代每 5s 全量 tick）
  const [previewTick, setPreviewTick] = useState(0);
  useEffect(() => {
    queueMicrotask(() => {
      if (typeof Notification !== "undefined") setNotifyPermission(Notification.permission);
    });
  }, []);

  useEffect(() => {
    const doneRef = { current: false };
    // 已知 run 集合：重跑追加的新 run 首次经 SSE 出现时补拉全量，新卡片即时上屏
    const knownIds = new Set<string>();
    // 已补拉轨迹的 run 集合：轮询兜底期间避免对已完成对局反复全量重拉（闭包 events 恒为空数组的旧 bug）
    const loadedTraj = new Set<string>();
    const load = async () => {
      const res = await fetch(`/api/matches/${id}`);
      if (res.ok) {
        const { match, runs } = await res.json();
        setRuns(runs);
        runs.forEach((r: RunDTO) => knownIds.add(r.id));
        setMatchStatus(match.status);
        if (["completed", "partial"].includes(match.status)) doneRef.current = true;
        // 兜底回放：只补拉尚未加载的 run，且并行拉取（刷新/断流后仍有数据；已加载的跳过）
        const missing = runs.filter((r: RunDTO) => !loadedTraj.has(r.id));
        if (missing.length > 0) {
          const settled = await Promise.all(missing.map(async (r: RunDTO) => ({
            runId: r.id,
            events: (await (await fetch(`/api/matches/${id}/trajectory?runId=${r.id}`)).json()).events as ArenaEvent[] | undefined,
          })));
          for (const { runId, events } of settled) {
            loadedTraj.add(runId);
            // SSE 实时事件先到时已有增量，不覆盖（补拉只填历史空窗）
            if (events?.length) setEvents((prev) => (prev[runId]?.length ? prev : { ...prev, [runId]: events }));
          }
        }
      }
    };
    load();
    const poll = setInterval(() => { if (!doneRef.current) load(); }, 5000);
    // SSE 实时事件：100ms 批量合并入 state（React 18 自动批处理覆盖不到异步 SSE 回调，
    // 高频 thinking/tool 事件逐个 setState 会触发整页反复重渲染，长对局卡死浏览器）
    const pendingRef: Record<string, ArenaEvent[]> = {};
    let flushTimer: ReturnType<typeof setTimeout> | null = null;
    const flushPending = () => {
      flushTimer = null;
      if (Object.keys(pendingRef).length === 0) return;
      const buf = pendingRef;
      for (const k of Object.keys(buf)) delete pendingRef[k];
      setEvents((prev) => {
        const next: Record<string, ArenaEvent[]> = { ...prev };
        for (const [runId, evs] of Object.entries(buf)) {
          next[runId] = [...(next[runId] ?? []), ...evs];
        }
        return next;
      });
    };
    const es = new EventSource(`/api/matches/${id}/stream`);
    es.onopen = () => setSseConnected(true);
    es.onerror = () => setSseConnected(false); // EventSource 自动重连，重连成功后 onopen 会复位
    es.onmessage = (m) => {
      const e = JSON.parse(m.data);
      if (e.channel === "run-event") {
        (pendingRef[e.runId] ??= []).push(e.event);
        if (flushTimer == null) flushTimer = setTimeout(flushPending, 100);
        // 文件产物类事件驱动预览刷新：写完文件/工具调用返回/对局结束即重拉文件清单
        if (e.event.kind === "file_edit" || e.event.kind === "tool_call" || e.event.kind === "done") {
          setPreviewTick((k) => k + 1);
        }
      } else if (e.channel === "run-status") {
        // 重跑追加的新 run：SSE 先于轮询到达时列表里还没有它，补拉一次让新卡片上屏
        if (!knownIds.has(e.runId)) {
          knownIds.add(e.runId);
          load();
        }
        // 事件直接携带完整运行 DTO（终态前指标/验证已落库），整行合并，无需终态补拉
        setRuns((prev) => prev.map((r) => (r.id === e.runId ? (e.run ?? { ...r, status: e.status, error: e.error ?? r.error }) : r)));
      } else if (e.channel === "match-status") {
        setMatchStatus(e.status);
        if (e.status === "running") doneRef.current = false; // 重跑/首轮启动：恢复轮询直到终态
        else if (["completed", "partial"].includes(e.status)) doneRef.current = true;
      }
    };
    return () => { clearInterval(poll); if (flushTimer != null) clearTimeout(flushTimer); es.close(); };
  }, [id, reloadTick]);

  const rerun = async (combos?: { harness: string; model: string }[]) => {
    const res = await fetch(`/api/matches/${id}/rerun`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(combos ? { combos } : {}),
    });
    if (res.ok) setReloadTick((t) => t + 1); // 同对局追加 runs，原地刷新数据流
  };

  // 手动停止单个 agent：杀进程树，run-status 事件会把 failed + 原因推回
  const stopOne = async (runId: string) => {
    await fetch(`/api/matches/${id}/stop`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId }),
    });
  };

  // 终态桌面通知：对局结束且已授权时弹出系统通知
  useEffect(() => {
    if (!["completed", "partial"].includes(matchStatus)) return;
    try {
      if (typeof Notification !== "undefined" && Notification.permission === "granted") {
        new Notification("对局已结束", { body: `对局 ${id} · ${matchStatus}` });
      }
    } catch {}
  }, [matchStatus, id]);

  return (
    <main className="w-full space-y-4 p-6">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <h1 className="truncate font-mono text-sm text-white/50">对局 {id}</h1>
          {/* 对局状态切换时弹跳换新 */}
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.span
              key={matchStatus}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8, transition: { duration: 0.12 } }}
              className={`shrink-0 rounded-full px-2.5 py-0.5 text-xs ${STATUS_STYLE[matchStatus] ?? "bg-white/10 text-white/60"}`}
            >
              {matchStatus}
            </motion.span>
          </AnimatePresence>
          {/* SSE 连接徽章：绿=实时推送中；红=断流（5s 轮询兜底，EventSource 自动重连） */}
          {sseConnected !== null && (
            <span
              className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] ${
                sseConnected ? "bg-emerald-400/10 text-emerald-300/70" : "bg-amber-400/15 text-amber-300"
              }`}
              title={sseConnected ? "实时推送连接正常" : "实时推送断开，已切换 5 秒轮询兜底，EventSource 正在自动重连"}
            >
              {sseConnected ? "实时" : "重连中"}
            </span>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {notifyPermission === "default" && (
            <button
              className="glass cursor-pointer rounded-full px-4 py-1.5 text-sm text-white/70 hover:bg-white/10 hover:text-white"
              title="对局结束时弹出系统通知"
              onClick={async () => setNotifyPermission(await Notification.requestPermission())}
            >
              通知
            </button>
          )}
          <a
            className="glass cursor-pointer rounded-full px-4 py-1.5 text-sm text-white/70 hover:bg-white/10 hover:text-white"
            href={`/api/matches/${id}/report`}
          >
            导出报告
          </a>
          <a
            className="glass cursor-pointer rounded-full px-4 py-1.5 text-sm text-white/70 hover:bg-white/10 hover:text-white"
            title="自包含单文件，浏览器直接打开，最终回答完整不截断"
            href={`/api/matches/${id}/report?format=html`}
          >
            导出 HTML
          </a>
          <button
            className="glass cursor-pointer rounded-full px-4 py-1.5 text-sm text-white/70 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            disabled={runs.length < 2}
            onClick={() => setShowDiff(true)}
          >
            产出对比
          </button>
          <motion.button
            whileTap={{ scale: 0.95 }}
            className="glass shrink-0 cursor-pointer rounded-full px-4 py-1.5 text-sm text-white/70 hover:bg-white/10 hover:text-white disabled:cursor-not-allowed disabled:opacity-40"
            disabled={matchStatus === "running"}
            title="在本对局追加一轮全部组合，旧卡片保留，新旧同屏对比"
            onClick={() => rerun()}
          >
            一键重跑（看方差）
          </motion.button>
        </div>
      </div>
      {["completed", "partial"].includes(matchStatus) && runs.length > 0 && <ComparisonTable runs={runs} />}
      {/* 卡片 tab 导航：点击平滑滚动到对应卡片，无需拖滚动条 */}
      {runs.length > 0 && (
        <div className="no-scrollbar flex items-center gap-2 overflow-x-auto">
          {runs.map((r, i) => (
            <button
              key={r.id}
              onClick={() => {
                setActiveRunId(r.id);
                document.getElementById(`run-card-${r.id}`)?.scrollIntoView({ behavior: "smooth", inline: "start", block: "nearest" });
              }}
              className={`flex shrink-0 cursor-pointer items-center gap-1.5 rounded-full px-3 py-1.5 font-mono text-xs transition-colors duration-200 ${
                activeRunId === r.id ? "bg-white/15 text-white" : "glass text-white/50 hover:bg-white/10 hover:text-white"
              }`}
            >
              <span className={`size-1.5 shrink-0 rounded-full ${STATUS_STYLE[r.status]?.split(" ")[0] ?? "bg-white/30"}`} />
              {i + 1}. {r.harness} · {r.model}
            </button>
          ))}
        </div>
      )}
      <div className="no-scrollbar flex gap-4 overflow-x-auto">
        {runs.map((r) => (
          <RunPanel key={r.id} id={`run-card-${r.id}`} run={r} events={events[r.id] ?? []} matchId={id} onRerunOne={(c) => rerun([c])} onStopOne={stopOne} />
        ))}
        {runs.length === 0 && (
          <div className="glass rounded-3xl p-8 text-sm text-white/40">等待运行启动…</div>
        )}
      </div>
      <PreviewGrid matchId={id} runs={runs} tick={previewTick} />
      {showDiff && <RunDiff matchId={id} runs={runs} onClose={() => setShowDiff(false)} />}
    </main>
  );
}
