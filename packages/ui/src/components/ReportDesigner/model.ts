import { clampLayout, GRID_COLS, type LayoutsById } from "../ReportGrid/stackOrder";
import type { CardLayout, ChartType, ReportCard, ReportCardData, ReportConfig } from "../reportTypes";

/** Page and card limits of the report configuration (report_config.py). */
export const REPORT_LIMITS = {
  cards: 30,
  title: 200,
  name: 120,
  unit: 16,
  colors: 20,
  versions: 20,
  rowHeight: { min: 20, max: 400 },
  precision: { min: 0, max: 6 },
  maxY: 1000,
} as const;

export const AGGS = ["sum", "avg", "min", "max", "count"] as const;
export type Agg = (typeof AGGS)[number];
export const TIME_GRAINS = ["day", "month", "year"] as const;
export type TimeGrain = (typeof TIME_GRAINS)[number];
export const DIMENSION_KINDS = ["date", "category", "none"] as const;
export type DimensionKind = (typeof DIMENSION_KINDS)[number];
export const NUMERIC_TYPES: readonly string[] = ["integer", "decimal", "amount"];

/** A template a card may bind, from the report catalog (API CatalogTemplate). */
export interface DesignerTemplate {
  template_id: number;
  code: string;
  name: string;
  scope: "system" | "tenant";
  /** false: kept only for the versions this report already binds; no new binding. */
  usable: boolean;
  versions: { id: number; version: number; name: string; current: boolean }[];
}

export interface DesignerGrain {
  grain: "document" | "table";
  table_key?: string | null;
  name?: string | null;
  names?: Record<string, unknown> | null;
  versions: number[];
  compatible: boolean;
}

export interface DesignerField {
  path: string;
  name: string;
  names?: Record<string, unknown> | null;
  type: string;
  grain: "document" | "table";
  table_key?: string | null;
  versions: number[];
  compatible: boolean;
}

/** The grains and fields of the selected versions of one template (API CatalogFieldsOut). */
export interface DesignerFields {
  grains: DesignerGrain[];
  fields: DesignerField[];
}

/** One problem of the page or of a card ({card_id, path, message}; API ReportError). */
export interface ReportProblem {
  card_id: string | null;
  path: string;
  message: string;
}

/** Card sizes on the 12-column grid when added from the palette. */
export const DEFAULT_SIZES: Record<ChartType, { w: number; h: number }> = {
  bar: { w: 6, h: 4 },
  line: { w: 6, h: 4 },
  pie: { w: 4, h: 4 },
  donut: { w: 4, h: 4 },
  metric: { w: 3, h: 2 },
  table: { w: 6, h: 4 },
};

export function emptyReportConfig(): ReportConfig {
  return { version: 1, period: { mode: "current_year", from: null, to: null }, grid: { cols: GRID_COLS, row_height: 80 }, cards: [] };
}

/** A new card id: stable, unique in the page, `^[A-Za-z0-9_-]{1,64}$`. */
export function newCardId(existing: Iterable<string>, random: () => number = Math.random): string {
  const taken = new Set(existing);
  for (;;) {
    const id = `card_${Math.floor(random() * 36 ** 8)
      .toString(36)
      .padStart(8, "0")}`;
    if (!taken.has(id)) return id;
  }
}

export function overlaps(a: CardLayout, b: CardLayout): boolean {
  return a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
}

/** The first free place (top to bottom, left to right) for a w×h card; else below everything. */
export function findPlace(layouts: readonly CardLayout[], w: number, h: number, cols = GRID_COLS): { x: number; y: number } {
  const bottom = layouts.reduce((m, l) => Math.max(m, l.y + l.h), 0);
  for (let y = 0; y < bottom; y += 1) {
    for (let x = 0; x + w <= cols; x += 1) {
      const box = { x, y, w, h };
      if (!layouts.some((l) => overlaps(box, l))) return { x, y };
    }
  }
  return { x: 0, y: bottom };
}

/** The data a new card starts with: nothing chosen yet, so the draft marks what is missing. */
export function defaultCardData(type: ChartType): ReportCardData {
  const data: ReportCardData = {
    template_id: null,
    template_version_ids: [],
    grain: "document",
    table_key: null,
    measure: { agg: "sum", path: null },
    unit: { mode: "fixed", value: "" },
    confirmed_paths: [],
  };
  if (type === "line") data.dimension = { kind: "date", path: null, time_grain: "month" };
  else if (type === "bar" || type === "pie" || type === "donut") data.dimension = { kind: "category", path: null };
  else if (type === "table") data.dimension = { kind: "none" };
  return data;
}

export function addCard(config: ReportConfig, type: ChartType, id?: string): { config: ReportConfig; id: string } {
  const cardId = id ?? newCardId(config.cards.map((c) => c.id));
  const size = DEFAULT_SIZES[type];
  const place = findPlace(
    config.cards.map((c) => c.layout),
    size.w,
    size.h,
  );
  const card: ReportCard = {
    id: cardId,
    type,
    title: "",
    layout: { ...place, ...size },
    data: defaultCardData(type),
    style: { precision: 2 },
  };
  return { config: { ...config, cards: [...config.cards, card] }, id: cardId };
}

export function removeCard(config: ReportConfig, id: string): ReportConfig {
  return { ...config, cards: config.cards.filter((c) => c.id !== id) };
}

export function updateCard(config: ReportConfig, id: string, fn: (card: ReportCard) => ReportCard): ReportConfig {
  return { ...config, cards: config.cards.map((c) => (c.id === id ? fn(c) : c)) };
}

/** New grid positions from the canvas (drag, resize or keyboard), kept inside the grid. */
export function applyLayouts(config: ReportConfig, layouts: LayoutsById): ReportConfig {
  let changed = false;
  const cards = config.cards.map((c) => {
    const l = layouts[c.id];
    if (!l) return c;
    const next = clampLayout(l);
    if (next.x === c.layout.x && next.y === c.layout.y && next.w === c.layout.w && next.h === c.layout.h) return c;
    changed = true;
    return { ...c, layout: next };
  });
  return changed ? { ...config, cards } : config;
}

/** The chart type rules: metric has no dimension; metric, pie and donut have no series;
 * bar, line, pie and donut need a date or category dimension. */
export function changeType(card: ReportCard, type: ChartType): ReportCard {
  const data: ReportCardData = { ...(card.data ?? {}) };
  if (type === "metric") {
    delete data.dimension;
    data.series = null;
  } else {
    if (type === "pie" || type === "donut") data.series = null;
    const kind = data.dimension?.kind ?? "none";
    if (type !== "table" && kind === "none") {
      data.dimension = type === "line" ? { kind: "date", path: null, time_grain: "month" } : { kind: "category", path: null };
    } else if (!data.dimension) {
      data.dimension = { kind: "none" };
    }
  }
  return { ...card, type, data: pruneConfirmed(data) };
}

/** Every template path the card reads (the ones a multi-version card must confirm). */
export function usedPaths(data: ReportCardData | null | undefined): string[] {
  if (!data) return [];
  const out: string[] = [];
  const push = (p: string | null | undefined) => {
    if (p && !out.includes(p)) out.push(p);
  };
  if (data.grain === "table") push(data.table_key);
  if (data.measure?.agg !== "count") push(data.measure?.path);
  if (data.dimension && data.dimension.kind !== "none") push(data.dimension.path);
  push(data.series?.path);
  push(data.date_field?.path);
  if (data.measure?.agg !== "count") push(data.unit?.path);
  return out;
}

/** Keep only confirmations of paths still in use. */
export function pruneConfirmed(data: ReportCardData): ReportCardData {
  const used = usedPaths(data);
  const confirmed = (data.confirmed_paths ?? []).filter((p) => used.includes(p));
  return { ...data, confirmed_paths: confirmed };
}

/** The template and versions of a card changed: start the data over (paths may differ). */
export function bindTemplate(card: ReportCard, templateId: number, versionIds: number[]): ReportCard {
  const prev = card.data ?? {};
  const agg = prev.measure?.agg ?? "sum";
  const data: ReportCardData = {
    template_id: templateId,
    template_version_ids: versionIds,
    grain: "document",
    table_key: null,
    measure: { agg, path: null },
    unit: agg === "count" ? prev.unit : { mode: "fixed", value: prev.unit?.mode === "fixed" ? (prev.unit.value ?? "") : "" },
    confirmed_paths: [],
    series: null,
    date_field: null,
  };
  if (card.type !== "metric") {
    const kind = prev.dimension?.kind ?? "none";
    data.dimension = kind === "date" ? { kind, path: null, time_grain: prev.dimension?.time_grain ?? "month" } : { kind, path: null };
  }
  return { ...card, data };
}

/** Other versions of the same template: the paths stay (the catalog marks what no longer
 * fits), but their meaning must be confirmed again for the new set. */
export function setVersions(card: ReportCard, versionIds: number[]): ReportCard {
  return { ...card, data: { ...(card.data ?? {}), template_version_ids: versionIds, confirmed_paths: [] } };
}

/** The field options of a card for one role, from the catalog of its versions. */
export function fieldOptions(
  fields: readonly DesignerField[],
  data: ReportCardData | null | undefined,
  role: "measure" | "dimension-date" | "dimension-category" | "series" | "date" | "unit",
): DesignerField[] {
  const table = data?.grain === "table" ? (data.table_key ?? null) : null;
  const inScope = (f: DesignerField) => f.grain === "document" || (table !== null && f.table_key === table);
  switch (role) {
    case "measure":
      // a table grain measures a column of the selected table only (no header totals)
      return fields.filter((f) => NUMERIC_TYPES.includes(f.type) && (table === null ? f.grain === "document" : f.table_key === table));
    case "dimension-date":
    case "date":
      return fields.filter((f) => f.type === "date" && inScope(f));
    default:
      return fields.filter((f) => f.type === "string" && inScope(f));
  }
}

/** A grain change: drop the paths that the new grain cannot use. */
export function setGrain(card: ReportCard, grain: "document" | "table", tableKey: string | null, fields: readonly DesignerField[]): ReportCard {
  const prev = card.data ?? {};
  const data: ReportCardData = { ...prev, grain, table_key: grain === "table" ? tableKey : null };
  const keep = (path: string | null | undefined, role: Parameters<typeof fieldOptions>[2]) =>
    path && fieldOptions(fields, data, role).some((f) => f.path === path) ? path : null;
  if (data.measure) data.measure = { ...data.measure, path: data.measure.agg === "count" ? null : keep(data.measure.path, "measure") };
  if (data.dimension && data.dimension.kind !== "none") {
    data.dimension = {
      ...data.dimension,
      path: keep(data.dimension.path, data.dimension.kind === "date" ? "dimension-date" : "dimension-category"),
    };
  }
  if (data.series?.path) data.series = keep(data.series.path, "series") ? data.series : null;
  if (data.date_field?.path) data.date_field = keep(data.date_field.path, "date") ? data.date_field : null;
  if (data.unit?.path) data.unit = { ...data.unit, path: keep(data.unit.path, "unit") };
  return { ...card, data: pruneConfirmed(data) };
}

/** The display name of a catalog entry in the UI language, else its default name. */
export function localName(entry: { name?: string | null; names?: Record<string, unknown> | null; path?: string }, lang?: string): string {
  const own = lang ? entry.names?.[lang] : undefined;
  if (typeof own === "string" && own.trim()) return own;
  return entry.name?.trim() || entry.path || "";
}

const CARD_PATH = /^cards\[(\d+)\]\.?(.*)$/;

/** Problems by card id (unknown ids by their index), plus those of the page. */
export function groupProblems(
  problems: readonly ReportProblem[],
  cards: readonly ReportCard[],
): { page: ReportProblem[]; byCard: Map<string, { rel: string; problem: ReportProblem }[]> } {
  const page: ReportProblem[] = [];
  const byCard = new Map<string, { rel: string; problem: ReportProblem }[]>();
  for (const p of problems) {
    const m = p.path.match(CARD_PATH);
    const id = p.card_id ?? (m ? cards[Number(m[1])]?.id : undefined);
    if (!m || !id || !cards.some((c) => c.id === id)) {
      page.push(p);
      continue;
    }
    const list = byCard.get(id) ?? [];
    list.push({ rel: m[2] ?? "", problem: p });
    byCard.set(id, list);
  }
  return { page, byCard };
}
