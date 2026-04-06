import type { ChartEngineMetadata } from "../types";

export function chartEngineLog(message: string, data?: Record<string, unknown>): void {
  if (process.env.NODE_ENV === "development") {
    console.info(`[chart-engine] ${message}`, data ?? "");
  }
}

export function appendLog(meta: ChartEngineMetadata, line: string): void {
  meta.logs.push(line);
  chartEngineLog(line);
}
