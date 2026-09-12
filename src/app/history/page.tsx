"use client";
import { useEffect, useState } from "react";
import Link from "next/link";

type MatchRow = { id: string; prompt: string; combos: string; status: string; createdAt: string };

export default function HistoryPage() {
  const [matches, setMatches] = useState<MatchRow[]>([]);
  useEffect(() => {
    fetch("/api/matches").then((r) => r.json()).then((d) => setMatches(d.matches ?? []));
  }, []);
  return (
    <main className="max-w-4xl mx-auto p-8 space-y-4">
      <h1 className="text-xl font-bold">历史对局</h1>
      <div className="text-sm"><a className="text-blue-600 underline" href="/">← 返回配置页</a></div>
      {matches.length === 0 && <div className="text-gray-500">还没有对局</div>}
      {matches.map((m) => (
        <Link key={m.id} href={`/match/${m.id}`} className="block border rounded p-3 hover:bg-gray-50">
          <div className="font-mono text-xs text-gray-400">{m.id} · {m.status} · {new Date(m.createdAt).toLocaleString()}</div>
          <div className="text-sm truncate">{m.prompt}</div>
          <div className="text-xs text-gray-500">{JSON.parse(m.combos).map((c: { harness: string; model: string }) => `${c.harness}×${c.model}`).join("，")}</div>
        </Link>
      ))}
    </main>
  );
}
