"use client";
import { useEffect, useState } from "react";

// 产出文件查看弹层：文本直接展示；HTML 用沙箱 iframe 预览（allow-scripts，无同源权限）
export default function FileViewer({ matchId, runId, filePath, onClose }: {
  matchId: string; runId: string; filePath: string; onClose: () => void;
}) {
  const [data, setData] = useState<{ content: string; truncated: boolean; size: number } | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    setData(null); setError("");
    fetch(`/api/matches/${matchId}/file?runId=${runId}&path=${encodeURIComponent(filePath)}`)
      .then((r) => r.json())
      .then((d) => (d.error ? setError(d.error) : setData(d)))
      .catch(() => setError("加载失败"));
  }, [matchId, runId, filePath]);

  const isHtml = /\.html?$/i.test(filePath);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-6" onClick={onClose}>
      <div className="glass-strong flex max-h-[85vh] w-full max-w-4xl flex-col rounded-3xl p-5" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-4">
          <div className="truncate font-mono text-sm text-sky-300" title={filePath}>{filePath}</div>
          <button
            className="shrink-0 cursor-pointer rounded-full bg-white/10 px-3 py-1 text-xs text-white/70 hover:bg-white/20"
            onClick={onClose}
          >
            关闭
          </button>
        </div>
        {error && <div className="mt-3 text-sm text-red-400">{error}</div>}
        {data?.truncated && <div className="mt-2 text-xs text-amber-300">文件超过 1MB，仅显示前 1MB</div>}
        {data && isHtml && (
          <iframe
            title={filePath}
            sandbox="allow-scripts"
            srcDoc={data.content}
            className="mt-3 h-[65vh] w-full rounded-2xl border border-white/10 bg-white"
          />
        )}
        {data && !isHtml && (
          <pre className="mt-3 max-h-[65vh] overflow-auto rounded-2xl border border-white/10 bg-black/40 p-3 font-mono text-xs whitespace-pre-wrap break-all text-white/80">
            {data.content}
          </pre>
        )}
      </div>
    </div>
  );
}
