import type { CardErrorCode, ChartType } from "../reportTypes";

/** Texts of ChartRenderer; apps pass their translations (English defaults). */
export interface ChartLabels {
  loading: string;
  empty: string;
  /** Status "not_applicable": the page period does not apply to this card (no date field). */
  notApplicable: string;
  error: string;
  errors: Partial<Record<CardErrorCode | string, string>>;
  retry: string;
  /** Label of a null dimension / series value. */
  unknown: string;
  value: string;
  count: string;
  category: string;
  series: string;
  unit: string;
  /** Shown instead of a null value (empty bucket). */
  noValue: string;
  /** Values too large to plot; the exact numbers are still in the table. */
  outOfRange: string;
  chartTypes: Record<ChartType, string>;
  /** aria-label summary of a chart. */
  summary: (info: { title: string; type: string; points: number; series: number }) => string;
}

export const DEFAULT_CHART_LABELS: ChartLabels = {
  loading: "Loading…",
  empty: "No data for this period",
  notApplicable: "The page date range does not apply to this card",
  error: "This card could not be loaded",
  errors: {
    query_timeout: "The query took too long. Narrow the date range or filters and retry.",
    group_limit: "Too many groups (over 1000). Narrow the range or choose a coarser grouping.",
    mixed_units: "Values use different units or currencies. Group by the unit field.",
    negative_in_pie: "Pie and donut charts cannot show negative values. Use a bar or line chart.",
    invalid_config: "This card is not configured correctly.",
  },
  retry: "Retry",
  unknown: "Unknown",
  value: "Value",
  count: "Count",
  category: "Category",
  series: "Series",
  unit: "Unit",
  noValue: "—",
  outOfRange: "Some values are too large to plot; see the exact values in the table.",
  chartTypes: {
    bar: "Bar chart",
    line: "Line chart",
    pie: "Pie chart",
    donut: "Donut chart",
    metric: "Metric",
    table: "Table",
  },
  summary: ({ title, type, points, series }) =>
    `${title ? `${title}: ` : ""}${type}, ${points} data point${points === 1 ? "" : "s"}` +
    (series > 1 ? ` in ${series} series` : ""),
};

export function mergeChartLabels(labels?: Partial<ChartLabels>): ChartLabels {
  if (!labels) return DEFAULT_CHART_LABELS;
  return {
    ...DEFAULT_CHART_LABELS,
    ...labels,
    errors: { ...DEFAULT_CHART_LABELS.errors, ...labels.errors },
    chartTypes: { ...DEFAULT_CHART_LABELS.chartTypes, ...labels.chartTypes },
  };
}
