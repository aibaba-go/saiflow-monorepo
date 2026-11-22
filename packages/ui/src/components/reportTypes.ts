/**
 * Report configuration card and query result shapes (reporting spec; API contract §5).
 * Kept structural so the generated API client types can be passed in directly.
 */

export type ChartType = "bar" | "line" | "pie" | "donut" | "metric" | "table" | "image" | "html";

export const CHART_TYPES: readonly ChartType[] = ["bar", "line", "pie", "donut", "metric", "table", "image", "html"];

export interface FilterRule {
  path: string;
  op: "eq" | "neq" | "in" | "not_in" | "empty" | "not_empty" | "contains" | "gt" | "gte" | "lt" | "lte" | "between";
  value?: string | string[];
}

export interface FilterGroup {
  match: "and" | "or";
  rules: FilterRule[];
}

export interface ReportAppearance {
  theme?: "brand" | "ocean" | "sunset" | "forest";
  background?: string;
  radius?: number;
  gap?: number;
  shadow?: boolean;
}

export const REPORT_PALETTES = {
  brand: ["#1764C0", "#18A999", "#F5AD3C", "#764EC4", "#E06484", "#34496E"],
  ocean: ["#0869A6", "#13AAB4", "#6574CD", "#53BDA5", "#88A5DE", "#DE9862"],
  sunset: ["#D96464", "#ED9B4B", "#9763BA", "#D5B455", "#528EA3", "#D26CA6"],
  forest: ["#2B8866", "#89AE4A", "#D3AD48", "#439DA8", "#746CB5", "#BE7960"],
} as const;

export interface CardLayout {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ReportCardStyle {
  direction?: "vertical" | "horizontal";
  fill?: boolean;
  surface?: "white" | "tinted";
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

export interface DesignerSource {
  id: string;
  name: string;
  kind: string;
  enabled?: boolean;
}

export interface SourceRelation {
  schema: string;
  name: string;
  kind: "table" | "view";
}

export interface DataColumn {
  key: string;
  label: string;
  type: string;
}

export interface TableResult {
  columns: DataColumn[];
  rows: Record<string, string | null>[];
  page: number;
  page_size: number;
  total: number;
}

export interface ReportCardData {
  source_id?: string | null;
  sql?: string | null;
  query_mode?: "sql" | "table";
  relation?: { schema: string; name: string } | null;
  result_fields?: DataColumn[] | null;
  display_fields?: { path: string; label: string }[] | null;
  page_size?: number;
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
  filters?: FilterGroup | null;
}

export interface ReportCard {
  id: string;
  type: ChartType;
  title?: string | null;
  layout: CardLayout;
  data?: ReportCardData | null;
  style?: ReportCardStyle | null;
  content?: {
    asset_id?: string;
    alt?: string;
    fit?: "contain" | "cover";
    mode?: "html" | "url";
    html?: string;
    url?: string;
  } | null;
}

export type CardResultStatus = "ok" | "error" | "not_applicable" | "empty";

export type CardErrorCode =
  | "query_timeout"
  | "group_limit"
  | "mixed_units"
  | "negative_in_pie"
  | "invalid_config"
  | "row_limit"
  | "source_unavailable"
  | "source_fields_changed";

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
  table?: TableResult | null;
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
  filters?: (FilterGroup & { targets: Record<string, Record<string, string>> }) | null;
  appearance?: ReportAppearance | null;
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
