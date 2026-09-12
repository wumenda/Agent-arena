"use client";
import { HARNESS_CATALOG } from "@/lib/arena/catalog";

export default function ModelSelect({
  value, onChange,
}: { value: { harness: string; model: string }; onChange: (v: { harness: string; model: string }) => void }) {
  return (
    <div className="flex gap-2">
      <select
        className="border rounded px-2 py-1 text-sm"
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
        className="border rounded px-2 py-1 text-sm flex-1"
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
