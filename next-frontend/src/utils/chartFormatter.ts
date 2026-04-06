/** Compact numeric labels for chart data points (e.g. 14000 → 14k). */

export function formatCompactNumber(n: number): string {
  if (n === 0) return "0";
  const abs = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (abs < 1000) {
    return sign + (Number.isInteger(n) ? String(Math.round(n)) : n.toFixed(1));
  }
  if (abs < 1_000_000) {
    const k = n / 1000;
    return sign + (Math.abs(k) >= 100 ? `${k.toFixed(0)}k` : `${k.toFixed(1)}k`.replace(/\.0k$/, "k"));
  }
  if (abs < 1_000_000_000) {
    const m = n / 1_000_000;
    return sign + `${m.toFixed(Math.abs(m) >= 10 ? 1 : 2)}M`.replace(/\.0+M$/, "M");
  }
  const b = n / 1_000_000_000;
  return sign + `${b.toFixed(2)}B`.replace(/\.00B$/, "B");
}

export function formatAxisTick(value: number): string {
  return formatCompactNumber(value);
}
