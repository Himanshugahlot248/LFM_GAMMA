export type ChartPayload = {
  chartType: "bar" | "line" | "pie" | "donut" | "stacked_bar" | "area" | "stacked_area" | "horizontal_bar";
  title: string;
  xLabel?: string;
  yLabel?: string;
  legendTitle?: string;
  series?: Array<{ key: string; label: string }>;
  data: Array<{ label: string; value?: number; [k: string]: string | number | undefined }>;
};

export type ChartTitleContext = {
  slideTitle?: string;
  bullets?: string[];
  description?: string;
  /** Uploaded file name (e.g. Income_Distribution_Pie_Chart.csv) for human-readable chart titles. */
  sourceFileName?: string | null;
};
