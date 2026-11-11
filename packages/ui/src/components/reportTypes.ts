/**
 * Report configuration card and query result shapes (reporting spec; API contract §5).
 * Kept structural so the generated API client types can be passed in directly.
 */

export type ChartType = "bar" | "line" | "pie" | "donut" | "metric" | "table";

export const CHART_TYPES: readonly ChartType[] = ["bar", "line", "pie", "donut", "metric", "table"];

export interface CardLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ReportCardStyle {
  precision?: number | null;
  colors?: string[] | null;
  legend?: boolean | null;
  labels?: boolean | null;
  stacked?: boolean | null;
  axis?: {
    show_x?: boolean | null;
    show_y?: boolean | null;
    x_title?: string | null;
    y_title?: string | null;
  } | null;
}

export interface ReportCardData {
  template_id?: number | null;
  template_version_ids?: number[] | null;
  grain?: "document" | "table" | null;
  table_key?: string | null;
  measure?: { path?: string | null; agg?: "sum" | "avg" | "min" | "max" | "count" | null } | null;
  dimension?: {
    kind?: "date" | "category" | "none" | null;
    path?: string | null;
    time_grain?: "day" | "month" | "year" | null;
  } | null;
  series?: { path?: string | null } | null;
  date_field?: { path?: string | null } | null;
  unit?: { mode?: "fixed" | "field" | null; value?: string | null; path?: string | null } | null;
  confirmed_paths?: string[] | null;
}

export interface ReportCard {
  id: string;
  type: ChartType;
  title?: string | null;
  layout: CardLayout;
  data?: ReportCardData | null;
  style?: ReportCardStyle | null;
}

export type CardResultStatus = "ok" | "error" | "not_applicable" | "empty";

export type CardErrorCode =
  | "query_timeout"
  | "group_limit"
  | "mixed_units"
  | "negative_in_pie"
  | "invalid_config";

export interface CardResultRow {
  dimension: string | null;
  series: string | null;
  unit: string | null;
  /** Exact decimal string; null for an empty bucket (never shown as 0). */
  value: string | null;
  count: number;
  /** Rows with a valid measure value (the avg denominator). */
  valid_count?: number;
}

export interface CardExcluded {
  invalid_number: number;
  too_precise: number;
  invalid_date: number;
  missing_date: number;
  empty_row: number;
  invalid_structure: number;
  missing: number;
}

export interface CardDiagnostics {
  /** Formal documents counted. */
  documents: number;
  /** Rows counted (documents, or detail rows for table grain). */
  items?: number;
  excluded: Partial<CardExcluded>;
}

export interface CardResult {
  card_id: string | null;
  status: CardResultStatus;
  error_code?: CardErrorCode | string | null;
  /** Whether the page period filtered this card (false = no date field: "not applicable"). */
  period_applied?: boolean;
  rows: CardResultRow[];
  diagnostics?: CardDiagnostics | null;
}

export interface ReportPeriodConfig {
  mode: "current_year" | "fixed";
  from?: string | null;
  to?: string | null;
}

/** A report page configuration (draft or published snapshot). */
export interface ReportConfig {
  version: 1;
  period?: ReportPeriodConfig | null;
  grid?: { cols?: number; row_height?: number } | null;
  cards: ReportCard[];
}

export interface QueryResult {
  generated_at: string;
  period: { from: string; to: string };
  scope: "all" | "own" | "synthetic";
  synthetic: boolean;
  /** The published version queried; null for a draft preview. */
  report_version: number | null;
  cards: CardResult[];
}
