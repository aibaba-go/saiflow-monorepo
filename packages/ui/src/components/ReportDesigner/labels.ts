import type { ChartType } from "../reportTypes";
import { DEFAULT_REPORT_ERROR_LABELS, type ReportErrorLabels } from "./messages";
import type { Agg, DimensionKind, TimeGrain } from "./model";

/** Texts of ReportDesigner; apps pass their translations (English defaults). User titles are
 * never translated. */
export interface ReportDesignerLabels {
  palette: string;
  add: (type: string) => string;
  cardLimit: (n: number) => string;
  canvas: string;
  emptyCanvas: string;
  /** Shown on a card that has no preview yet. */
  previewHint: string;
  previewStale: string;
  previewSynthetic: string;
  untitled: (type: string) => string;
  pagePanel: string;
  cardPanel: string;
  tabData: string;
  tabStyle: string;
  cardTitle: string;
  cardType: string;
  removeCard: string;
  removeConfirm: string;
  confirmOk: string;
  cancel: string;
  period: string;
  periodModes: { current_year: string; fixed: string };
  periodFrom: string;
  periodTo: string;
  periodHelp: string;
  rowHeight: string;
  template: string;
  templatePlaceholder: string;
  templateKept: string;
  scopes: { system: string; tenant: string };
  versions: string;
  versionLabel: (v: { version: number; name: string }) => string;
  versionCurrent: string;
  versionsHelp: string;
  loadingFields: string;
  fieldsFailed: string;
  retry: string;
  grain: string;
  grainDocument: string;
  grainTable: (name: string) => string;
  grainIncompatible: string;
  measure: string;
  agg: string;
  aggs: Record<Agg, string>;
  measureField: string;
  dimension: string;
  dimensionKinds: Record<DimensionKind, string>;
  dimensionField: string;
  timeGrain: string;
  timeGrains: Record<TimeGrain, string>;
  series: string;
  dateField: string;
  dateFieldHelp: string;
  none: string;
  unit: string;
  unitModes: { fixed: string; field: string };
  unitValue: string;
  unitField: string;
  unitCheckField: string;
  confirm: string;
  confirmHelp: string;
  fieldIncompatible: string;
  fieldUnavailable: string;
  fieldTypes: Record<string, string>;
  chooseField: string;
  precision: string;
  colors: string;
  colorsHelp: string;
  addColor: string;
  removeColor: (n: number) => string;
  legend: string;
  dataLabels: string;
  stacked: string;
  axis: string;
  showX: string;
  showY: string;
  xTitle: string;
  yTitle: string;
  errorSummary: (n: number) => string;
  errorsStale: string;
  cardProblems: (title: string, n: number) => string;
  chartTypes: Record<ChartType, string>;
  errors: ReportErrorLabels;
}

export const DEFAULT_REPORT_DESIGNER_LABELS: ReportDesignerLabels = {
  palette: "Charts",
  add: (type) => `Add ${type}`,
  cardLimit: (n) => `A page has at most ${n} cards`,
  canvas: "Report layout",
  emptyCanvas: "No cards yet. Add a chart from the left.",
  previewHint: "Preview to see data",
  previewStale: "The preview is older than your latest changes. Preview again to update it.",
  previewSynthetic: "Synthetic sample data, not customer data",
  untitled: (type) => `Untitled ${type.toLowerCase()}`,
  pagePanel: "Page settings",
  cardPanel: "Card",
  tabData: "Data",
  tabStyle: "Style",
  cardTitle: "Title",
  cardType: "Chart type",
  removeCard: "Remove card",
  removeConfirm: "Remove this card?",
  confirmOk: "Remove",
  cancel: "Cancel",
  period: "Default period",
  periodModes: { current_year: "Current year (Thailand)", fixed: "Fixed dates" },
  periodFrom: "From",
  periodTo: "To",
  periodHelp: "Both dates are included. Viewers can override the period for the whole page.",
  rowHeight: "Row height (px)",
  template: "Template",
  templatePlaceholder: "Choose a template",
  templateKept: "Kept for existing cards only",
  scopes: { system: "System", tenant: "Organization" },
  versions: "Template versions",
  versionLabel: ({ version, name }) => `v${version} · ${name}`,
  versionCurrent: "active",
  versionsHelp: "Only the chosen versions are counted; later versions are not added by themselves.",
  loadingFields: "Loading fields…",
  fieldsFailed: "The fields could not be loaded.",
  retry: "Retry",
  grain: "Data grain",
  grainDocument: "One row per document",
  grainTable: (name) => `One row per line of ${name}`,
  grainIncompatible: "not in every selected version",
  measure: "Measure",
  agg: "Aggregation",
  aggs: { sum: "Sum", avg: "Average", min: "Minimum", max: "Maximum", count: "Count" },
  measureField: "Measure field",
  dimension: "Group by",
  dimensionKinds: { date: "Date", category: "Category", none: "None" },
  dimensionField: "Dimension field",
  timeGrain: "Date grouping",
  timeGrains: { day: "Day", month: "Month", year: "Year" },
  series: "Series (split by)",
  dateField: "Period date",
  dateFieldHelp: "The page period filters on this date; without it, on the date dimension.",
  none: "None",
  unit: "Currency or unit",
  unitModes: { fixed: "Fixed label", field: "From a field" },
  unitValue: "Label",
  unitField: "Unit field",
  unitCheckField: "Check against field (optional)",
  confirm: "Same meaning in every selected version",
  confirmHelp: "These fields have the same path and type in every selected version. Confirm that each means the same.",
  fieldIncompatible: "not in every selected version",
  fieldUnavailable: "This field is not available for the selected versions or grain.",
  fieldTypes: { string: "Text", integer: "Integer", decimal: "Decimal", amount: "Amount", date: "Date", boolean: "Yes / No" },
  chooseField: "Choose a field",
  precision: "Decimals",
  colors: "Colors",
  colorsHelp: "Series colors in order; empty uses the default palette.",
  addColor: "Add color",
  removeColor: (n) => `Remove color ${n}`,
  legend: "Legend",
  dataLabels: "Value labels",
  stacked: "Stacked",
  axis: "Axes",
  showX: "Show X axis",
  showY: "Show Y axis",
  xTitle: "X axis title",
  yTitle: "Y axis title",
  errorSummary: (n) => `${n} problem${n === 1 ? "" : "s"} to fix before publishing`,
  errorsStale: "Found when the draft was last saved; save again to check your changes.",
  cardProblems: (title, n) => `${title}: ${n} problem${n === 1 ? "" : "s"}`,
  chartTypes: { bar: "Bar chart", line: "Line chart", pie: "Pie chart", donut: "Donut chart", metric: "Metric", table: "Table", image: "Image", html: "HTML / embedded page" },
  errors: DEFAULT_REPORT_ERROR_LABELS,
};

export function mergeReportDesignerLabels(labels?: Partial<ReportDesignerLabels>): ReportDesignerLabels {
  if (!labels) return DEFAULT_REPORT_DESIGNER_LABELS;
  const d = DEFAULT_REPORT_DESIGNER_LABELS;
  return {
    ...d,
    ...labels,
    periodModes: { ...d.periodModes, ...labels.periodModes },
    scopes: { ...d.scopes, ...labels.scopes },
    aggs: { ...d.aggs, ...labels.aggs },
    dimensionKinds: { ...d.dimensionKinds, ...labels.dimensionKinds },
    timeGrains: { ...d.timeGrains, ...labels.timeGrains },
    unitModes: { ...d.unitModes, ...labels.unitModes },
    fieldTypes: { ...d.fieldTypes, ...labels.fieldTypes },
    chartTypes: { ...d.chartTypes, ...labels.chartTypes },
    errors: { ...d.errors, ...labels.errors },
  };
}
