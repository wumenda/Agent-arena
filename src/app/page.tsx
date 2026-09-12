"use client";
import { useEffect, useState } from "react";
import ConfigForm from "@/components/ConfigForm";
import type { MatchConfig } from "@/lib/arena/types";

export default function Home() {
  const [input, setInput] = useState("");
  const [parsing, setParsing] = useState(false);
  const [config, setConfig] = useState<MatchConfig | null>(null);
  const [parseError, setParseError] = useState("");
  const [detect, setDetect] = useState<{ harness: string; installed: boolean; detail: string }[]>([]);

  useEffect(() => {
    fetch("/api/detect").then((r) => r.json()).then((d) => setDetect(d.results ?? []));
  }, []);

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
    if (data.config) setConfig(data.config);
    else setParseError("解析失败，请手动配置（或检查 .env.local 的 ARK_* 配置）");
  };

  return (
    <main className="max-w-3xl mx-auto p-8 space-y-6">
      <h1 className="text-2xl font-bold">模型-Agent 竞技场</h1>
      <div className="text-sm"><a className="text-blue-600 underline" href="/history">历史对局</a></div>
      <div className="text-xs text-gray-500">
        {detect.map((d) => (
          <span key={d.harness} className="mr-3">{d.installed ? "✅" : "❌"} {d.harness}</span>
        ))}
      </div>
      <div className="space-y-2">
        <textarea
          className="w-full border rounded p-3 text-sm"
          rows={2}
          placeholder="一句话描述对比，如：对比 claude code 和 codex 写一个贪吃蛇"
          value={input}
          onChange={(e) => setInput(e.target.value)}
        />
        <button className="border rounded px-3 py-1 text-sm disabled:opacity-50" disabled={parsing || !input.trim()} onClick={parse}>
          {parsing ? "解析中…" : "解析"}
        </button>
        {parseError && <div className="text-sm text-red-500">{parseError}</div>}
      </div>
      <hr />
      <ConfigForm initial={config} />
    </main>
  );
}
