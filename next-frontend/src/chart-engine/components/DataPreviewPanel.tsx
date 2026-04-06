"use client";

import type { ChartEngineMetadata } from "../types";

type Props = {
  metadata: ChartEngineMetadata;
  /** First N rows of raw-normalized data for preview */
  previewRows: Record<string, unknown>[];
  headers: string[];
};

/**
 * Parsed data + detection summary for transparency / debugging.
 */
export function DataPreviewPanel({ metadata, previewRows, headers }: Props) {
  const showRows = previewRows.slice(0, 8);
  return (
    <div className="mt-3 rounded-2xl border border-zinc-700/80 bg-black/40 p-3 text-left">
      <div className="text-[10px] font-bold uppercase tracking-wide text-amber-200/90">Parsed data preview</div>
      <div className="mt-2 space-y-1 text-[10px] text-zinc-400">
        <div>
          <span className="text-zinc-500">Input:</span> {metadata.inputType} ·{" "}
          <span className="text-zinc-500">Rows:</span> {metadata.rowCount}
          {metadata.downsampled ? (
            <span className="text-amber-200/80">
              {" "}
              (from {metadata.originalRowCount}, {metadata.downsampleMethod})
            </span>
          ) : null}
        </div>
        <div>
          <span className="text-zinc-500">X column:</span> {metadata.xColumnKey}{" "}
          <span className="text-zinc-500">· Y:</span> {metadata.yColumnKeys.join(", ")}
        </div>
        <div>
          <span className="text-zinc-500">Chart type:</span>{" "}
          <span className="font-semibold text-zinc-200">{metadata.chartType}</span>
        </div>
        <div>
          <span className="text-zinc-500">Columns detected:</span>{" "}
          {metadata.columns.map((c) => `${c.header} (${c.kind})`).join(" · ")}
        </div>
        {metadata.warnings.length ? (
          <div className="rounded-lg border border-amber-500/30 bg-amber-500/10 px-2 py-1 text-amber-100/90">
            {metadata.warnings.join(" ")}
          </div>
        ) : null}
      </div>
      {showRows.length ? (
        <div className="mt-2 max-h-[140px] overflow-auto rounded-lg border border-zinc-800">
          <table className="w-full min-w-[200px] border-collapse text-[9px] text-zinc-300">
            <thead>
              <tr className="border-b border-zinc-700 bg-zinc-900/80">
                {headers.map((h) => (
                  <th key={h} className="px-1.5 py-1 text-left font-semibold text-zinc-400">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {showRows.map((row, i) => (
                <tr key={i} className="border-b border-zinc-800/80">
                  {headers.map((h) => (
                    <td key={h} className="max-w-[120px] truncate px-1.5 py-0.5">
                      {row[h] === null || row[h] === undefined ? "—" : String(row[h])}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
