"use client";
import { HARNESS_CATALOG } from "@/lib/arena/catalog";

export default function ModelSelect({
  value, onChange,
}: { value: { harness: string; model: string }; onChange: (v: { harness: string; model: string }) => void }) {
  return (
    <div className="flex flex-1 gap-2">
      <select
        className="glass-input cursor-pointer rounded-xl px-2.5 py-1.5 text-sm text-white/90 transition focus:border-sky-400/50 focus:ring-2 focus:ring-sky-400/20 focus:outline-none [&>option]:bg-neutral-900"
        value={value.harness}
        onChange={(e) => {
          const h = e.target.value;
          const def = HARNESS_CATALOG.find((a) => a.id === h)?.models[0] ?? "";
          onChange({ harness: h, model: def });
        }}
      >
        {HARNESS_CATALOG.map((a) => (
          <option key={a.id} value={a.id}>{a.displayName}</option>
        ))}
      </select>
      <input
        className="glass-input min-w-0 flex-1 rounded-xl px-2.5 py-1.5 font-mono text-sm text-white/90 placeholder-white/30 transition focus:border-sky-400/50 focus:ring-2 focus:ring-sky-400/20 focus:outline-none"
        list={`models-${value.harness}`}
        value={value.model}
        onChange={(e) => onChange({ ...value, model: e.target.value })}
        placeholder="模型标识"
      />
      <datalist id={`models-${value.harness}`}>
        {(HARNESS_CATALOG.find((a) => a.id === value.harness)?.models ?? []).map((m) => <option key={m} value={m} />)}
      </datalist>
    </div>
  );
}
