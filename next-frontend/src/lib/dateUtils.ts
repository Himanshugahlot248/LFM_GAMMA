/**
 * Native/bridge APIs may return Unix **seconds**; JavaScript `Date` expects **milliseconds**.
 * Heuristic: values below 1e11 are treated as seconds (typical unix ts ~1e9–1e10).
 */
export function toDateFromApi(input: string | number | undefined | null): Date {
  if (input == null || input === "") return new Date(NaN);
  let n: number;
  if (typeof input === "string") {
    const trimmed = input.trim();
    if (/^\d+(\.\d+)?$/.test(trimmed)) {
      n = Number(trimmed);
    } else {
      return new Date(trimmed);
    }
  } else {
    n = input;
  }
  if (!Number.isFinite(n) || n <= 0) return new Date(NaN);
  if (n < 1e11) return new Date(n * 1000);
  return new Date(n);
}
