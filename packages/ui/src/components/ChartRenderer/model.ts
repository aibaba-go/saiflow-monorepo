import { clampPrecision, formatDecimal, isDecimalString } from "../decimal";
import type { CardResult, ReportCard } from "../reportTypes";
import type { ChartLabels } from "./labels";

/** One plotted value; `value` is only a drawing coordinate, `exact` the original decimal string. */
export interface ChartPoint {
  value: number | null;
  exact: string | null;
  display: string;
  unit: string | null;
  count: number;
}

export interface ChartSeriesModel {
  name: string;
  /** Aligned with `categories`; a missing or null bucket is a gap (value null), never 0. */
  points: ChartPoint[];
}

export interface DisplayRow {
  dimension: string;
  series: string | null;
  unit: string | null;
  display: string;
  exact: string | null;
  count: number;
}

export interface ChartModel {
  categories: string[];
  series: ChartSeriesModel[];
  units: string[];
  rows: DisplayRow[];
  hasDimension: boolean;
  hasSeries: boolean;
  outOfRange: boolean;
  pointCount: number;
}

function toCoordinate(exact: string | null): { value: number | null; out: boolean } {
  if (exact === null || !isDecimalString(exact)) return { value: null, out: false };
  const n = Number(exact);
  // Number() is for drawing only; beyond the float range the bar/line is left out and the
  // exact value stays in the table and tooltip.
  if (!Number.isFinite(n)) return { value: null, out: true };
  return { value: n, out: false };
}

export function displayValue(exact: string | null, precision: number, labels: ChartLabels): string {
  if (exact === null) return labels.noValue;
  return formatDecimal(exact, precision);
}

/** Group a card result into categories × series, keeping exact strings (FR-REPORT-011/013). */
export function buildChartModel(card: ReportCard, result: CardResult, labels: ChartLabels): ChartModel {
  const precision = clampPrecision(card.style?.precision);
  const dimKind = card.data?.dimension?.kind;
  const hasDimension = card.type !== "metric" && !!dimKind && dimKind !== "none";
  const hasSeries = !!card.data?.series?.path;
  const fixedUnit = card.data?.unit?.mode === "fixed" ? (card.data.unit.value ?? null) : null;
  const rows = result.rows ?? [];

  const unitOf = (u: string | null) => u ?? fixedUnit ?? null;
  const units = [...new Set(rows.map((r) => unitOf(r.unit)).filter((u): u is string => !!u))];
  const multiUnit = units.length > 1;
  const valueLabel = card.title?.trim() || labels.value;

  const dimLabel = (d: string | null) => (hasDimension ? (d ?? labels.unknown) : (d ?? valueLabel));
  const seriesBase = (s: string | null) => (hasSeries ? (s ?? labels.unknown) : valueLabel);

  const categories: string[] = [];
  const catIndex = new Map<string, number>();
  const seriesIndex = new Map<string, ChartSeriesModel>();
  let outOfRange = false;
  const displayRows: DisplayRow[] = [];

  // Keys use the raw values (null kept apart from a literal "Unknown" text) so two different
  // buckets never merge because they share a label.
  const catKeyOf = (d: string | null) => (d === null ? "\u0000null" : `v:${d}`);
  const pending: { cat: number; seriesKey: string; seriesName: string; point: ChartPoint }[] = [];

  for (const row of rows) {
    const unit = unitOf(row.unit);
    const catKey = catKeyOf(row.dimension);
    let ci = catIndex.get(catKey);
    if (ci === undefined) {
      ci = categories.length;
      categories.push(dimLabel(row.dimension));
      catIndex.set(catKey, ci);
    }
    const sName = seriesBase(row.series) + (multiUnit ? ` (${unit ?? labels.unknown})` : "");
    const sKey = `${row.series === null ? "\u0000null" : `v:${row.series}`}|${multiUnit ? (unit ?? "\u0000") : ""}`;
    const { value, out } = toCoordinate(row.value);
    if (out) outOfRange = true;
    const display = displayValue(row.value, precision, labels);
    pending.push({
      cat: ci,
      seriesKey: sKey,
      seriesName: sName,
      point: { value, exact: row.value, display, unit, count: row.count },
    });
    displayRows.push({
      dimension: dimLabel(row.dimension),
      series: hasSeries ? seriesBase(row.series) : null,
      unit,
      display,
      exact: row.value,
      count: row.count,
    });
  }

  const empty = (): ChartPoint => ({ value: null, exact: null, display: labels.noValue, unit: null, count: 0 });
  for (const p of pending) {
    let s = seriesIndex.get(p.seriesKey);
    if (!s) {
      s = { name: p.seriesName, points: [] };
      seriesIndex.set(p.seriesKey, s);
    }
    while (s.points.length < categories.length) s.points.push(empty());
    s.points[p.cat] = p.point;
  }
  const series = [...seriesIndex.values()];
  for (const s of series) while (s.points.length < categories.length) s.points.push(empty());

  return {
    categories,
    series,
    units,
    rows: displayRows,
    hasDimension,
    hasSeries,
    outOfRange,
    pointCount: rows.length,
  };
}
