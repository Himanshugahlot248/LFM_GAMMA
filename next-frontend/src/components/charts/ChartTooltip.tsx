"use client";

import { formatCompactNumber } from "@/utils/chartFormatter";

type TooltipPayload = {
  name?: string;
  value?: unknown;
  color?: string;
  dataKey?: string | number;
};

function formatVal(v: unknown): string {
  if (typeof v === "number") return formatCompactNumber(v);
  if (typeof v === "string" && /^-?\d/.test(v)) {
    const n = Number(v);
    if (!Number.isNaN(n)) return formatCompactNumber(n);
  }
  return String(v ?? "");
}

/** Dark card tooltip for Recharts (v2/v3 compatible props). */
export function PremiumChartTooltip(props: {
  active?: boolean;
  payload?: readonly TooltipPayload[];
  label?: unknown;
}) {
  const { active, payload, label } = props;
  if (!active || !payload?.length) return null;

  return (
    <div
      className="rounded-lg border border-zinc-600/80 bg-zinc-900/95 px-3 py-2.5 shadow-xl shadow-black/40 backdrop-blur-sm"
      style={{ borderRadius: 8 }}
    >
      {label != null && label !== "" ? (
        <div className="mb-1.5 border-b border-zinc-700/80 pb-1 text-xs font-semibold text-zinc-100">{String(label)}</div>
      ) : null}
      <div className="space-y-1">
        {payload.map((item, i) => (
          <div key={`${String(item.dataKey)}-${i}`} className="flex items-center gap-2 text-xs">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ backgroundColor: item.color ?? "#94a3b8" }}
            />
            <span className="text-zinc-400">{item.name ?? String(item.dataKey ?? "Value")}</span>
            <span className="ml-auto font-mono tabular-nums font-medium text-zinc-100">{formatVal(item.value)}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
