import { CHART_TYPES, type ReportCard } from "../reportTypes";
import { DEFAULT_REPORT_ERROR_LABELS, localizeReportError } from "./messages";
import {
  addCard,
  applyLayouts,
  bindTemplate,
  changeType,
  emptyReportConfig,
  fieldOptions,
  findPlace,
  groupProblems,
  localName,
  newCardId,
  overlaps,
  pruneConfirmed,
  removeCard,
  setGrain,
  setVersions,
  usedPaths,
  updateCard,
  type DesignerField,
} from "./model";

const f = (path: string, type: string, grain: "document" | "table" = "document", table_key: string | null = null): DesignerField => ({
  path,
  name: path,
  type,
  grain,
  table_key,
  versions: [1],
  compatible: true,
});
const FIELDS = [
  f("h.total", "amount"),
  f("h.date", "date"),
  f("h.vendor", "string"),
  f("h.currency", "string"),
  f("h.lines.qty", "integer", "table", "h.lines"),
  f("h.lines.product", "string", "table", "h.lines"),
  f("h.lines.ship", "date", "table", "h.lines"),
  f("h.other.n", "decimal", "table", "h.other"),
];

describe("report designer model", () => {
  it("adds all six types with unique valid ids and no overlap, inside the grid", () => {
    let config = emptyReportConfig();
    for (let i = 0; i < 3; i += 1) for (const t of CHART_TYPES) config = addCard(config, t).config;
    const ids = config.cards.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of config.cards) {
      expect(c.id).toMatch(/^[A-Za-z0-9_-]{1,64}$/);
      expect(c.layout.x + c.layout.w).toBeLessThanOrEqual(12);
      expect(c.layout.h).toBeGreaterThanOrEqual(2);
    }
    for (const a of config.cards) for (const b of config.cards) if (a !== b) expect(overlaps(a.layout, b.layout)).toBe(false);
  });

  it("fills gaps first and starts each type with the data it needs", () => {
    const place = findPlace([{ x: 0, y: 0, w: 6, h: 4 }], 6, 4);
    expect(place).toEqual({ x: 6, y: 0 });
    expect(findPlace([{ x: 0, y: 0, w: 12, h: 2 }], 3, 2)).toEqual({ x: 0, y: 2 });
    const { config, id } = addCard(emptyReportConfig(), "line", "L1");
    const card = config.cards.find((c) => c.id === id)!;
    expect(card.data?.dimension).toEqual({ kind: "date", path: null, time_grain: "month" });
    expect(addCard(emptyReportConfig(), "metric").config.cards[0]!.data?.dimension).toBeUndefined();
    expect(addCard(emptyReportConfig(), "table").config.cards[0]!.data?.dimension).toEqual({ kind: "none" });
    expect(removeCard(config, id).cards).toHaveLength(0);
  });

  it("invalidates page mappings on binding changes instead of querying without filters", () => {
    const { config } = addCard(emptyReportConfig(), "bar", "a");
    config.cards[0] = bindTemplate(config.cards[0]!, 12, [101]);
    config.filters = { match: "and", rules: [{ path: "vendor", op: "eq", value: "Acme" }], targets: { a: { vendor: "h.vendor" } } };
    const next = updateCard(config, "a", (card) => bindTemplate(card, 13, [102]));
    expect(next.filters?.targets.a).toEqual({});
    expect(next.filters?.rules).toEqual(config.filters.rules);
    expect(config.filters.targets.a).toEqual({ vendor: "h.vendor" });
  });

  it("removes static cards from page mappings without dropping other targets", () => {
    const { config } = addCard(emptyReportConfig(), "bar", "a");
    config.filters = { match: "and", rules: [{ path: "vendor", op: "eq", value: "Acme" }], targets: { a: { vendor: "h.vendor" }, b: { vendor: "supplier" } } };
    const next = updateCard(config, "a", (card) => changeType(card, "html"));
    expect(next.filters?.targets).toEqual({ b: { vendor: "supplier" } });
    expect(next.cards[0]?.data).toBeNull();
  });

  it("keeps mapped semantic confirmations during chart-type changes", () => {
    const { config } = addCard(emptyReportConfig(), "bar", "a");
    config.cards[0]!.data!.confirmed_paths = ["h.vendor"];
    config.filters = { match: "and", rules: [{ path: "vendor", op: "eq", value: "Acme" }], targets: { a: { vendor: "h.vendor" } } };
    expect(updateCard(config, "a", (card) => changeType(card, "pie")).cards[0]?.data?.confirmed_paths).toContain("h.vendor");
  });

  it("new ids never repeat an existing one", () => {
    const seq = [0.5, 0.5, 0.25];
    const id1 = newCardId([], () => 0.5);
    expect(newCardId([id1], () => seq.shift()!)).not.toBe(id1);
  });

  it("applies grid layouts clamped, keeping the object when nothing moved", () => {
    const { config } = addCard(emptyReportConfig(), "bar", "a");
    expect(applyLayouts(config, { a: { ...config.cards[0]!.layout } })).toBe(config);
    const moved = applyLayouts(config, { a: { x: 10, y: 3, w: 6, h: 40 } });
    expect(moved.cards[0]!.layout).toEqual({ x: 6, y: 3, w: 6, h: 12 });
  });

  it("changing the type follows the dimension and series rules", () => {
    const bar: ReportCard = {
      id: "a",
      type: "bar",
      layout: { x: 0, y: 0, w: 6, h: 4 },
      data: { measure: { agg: "sum", path: "h.total" }, dimension: { kind: "category", path: "h.vendor" }, series: { path: "h.currency" }, confirmed_paths: ["h.currency", "h.total"] },
    };
    const metric = changeType(bar, "metric");
    expect(metric.data?.dimension).toBeUndefined();
    expect(metric.data?.series).toBeNull();
    expect(metric.data?.confirmed_paths).toEqual(["h.total"]);
    const pie = changeType(bar, "pie");
    expect(pie.data?.series).toBeNull();
    expect(pie.data?.dimension?.path).toBe("h.vendor");
    expect(changeType(metric, "line").data?.dimension).toEqual({ kind: "date", path: null, time_grain: "month" });
    expect(changeType(metric, "table").data?.dimension).toEqual({ kind: "none" });
  });

  it("lists used paths (table key included, count without a measure) and prunes confirmations", () => {
    const data = {
      grain: "table" as const,
      table_key: "h.lines",
      measure: { agg: "count" as const, path: "h.lines.qty" },
      dimension: { kind: "category" as const, path: "h.lines.product" },
      date_field: { path: "h.date" },
      unit: { mode: "field" as const, path: "h.currency" },
      confirmed_paths: ["h.lines", "gone"],
    };
    expect(usedPaths(data)).toEqual(["h.lines", "h.lines.product", "h.date"]);
    expect(pruneConfirmed(data).confirmed_paths).toEqual(["h.lines"]);
  });

  it("binding another template starts the data over; other versions only clear confirmations", () => {
    const card: ReportCard = {
      id: "a",
      type: "line",
      layout: { x: 0, y: 0, w: 6, h: 4 },
      data: {
        template_id: 1,
        template_version_ids: [1, 2],
        measure: { agg: "avg", path: "h.total" },
        dimension: { kind: "date", path: "h.date", time_grain: "day" },
        unit: { mode: "fixed", value: "THB" },
        confirmed_paths: ["h.total", "h.date"],
      },
    };
    const rebound = bindTemplate(card, 9, [90]);
    expect(rebound.data).toMatchObject({
      template_id: 9,
      template_version_ids: [90],
      measure: { agg: "avg", path: null },
      dimension: { kind: "date", path: null, time_grain: "day" },
      unit: { mode: "fixed", value: "THB" },
      confirmed_paths: [],
    });
    const versions = setVersions(card, [1, 3]);
    expect(versions.data?.measure?.path).toBe("h.total");
    expect(versions.data?.confirmed_paths).toEqual([]);
  });

  it("offers fields by role and grain", () => {
    const doc = { grain: "document" as const };
    const tbl = { grain: "table" as const, table_key: "h.lines" };
    expect(fieldOptions(FIELDS, doc, "measure").map((x) => x.path)).toEqual(["h.total"]);
    expect(fieldOptions(FIELDS, tbl, "measure").map((x) => x.path)).toEqual(["h.lines.qty"]);
    expect(fieldOptions(FIELDS, tbl, "dimension-category").map((x) => x.path)).toEqual(["h.vendor", "h.currency", "h.lines.product"]);
    expect(fieldOptions(FIELDS, tbl, "date").map((x) => x.path)).toEqual(["h.date", "h.lines.ship"]);
    expect(fieldOptions(FIELDS, doc, "series").map((x) => x.path)).toEqual(["h.vendor", "h.currency"]);
  });

  it("a grain change drops the paths the new grain cannot use", () => {
    const card: ReportCard = {
      id: "a",
      type: "bar",
      layout: { x: 0, y: 0, w: 6, h: 4 },
      data: {
        grain: "table",
        table_key: "h.lines",
        measure: { agg: "sum", path: "h.lines.qty" },
        dimension: { kind: "category", path: "h.lines.product" },
        series: { path: "h.vendor" },
        date_field: { path: "h.lines.ship" },
        confirmed_paths: ["h.lines", "h.lines.qty", "h.vendor"],
      },
    };
    const doc = setGrain(card, "document", null, FIELDS);
    expect(doc.data).toMatchObject({
      grain: "document",
      table_key: null,
      measure: { agg: "sum", path: null },
      dimension: { kind: "category", path: null },
      series: { path: "h.vendor" },
      date_field: null,
      confirmed_paths: ["h.vendor"],
    });
  });

  it("groups problems by card id or index, the rest on the page", () => {
    const cards = [{ id: "a" }, { id: "b" }] as ReportCard[];
    const out = groupProblems(
      [
        { card_id: null, path: "period.from", message: "x" },
        { card_id: "b", path: "cards[1].data.measure.path", message: "y" },
        { card_id: null, path: "cards[0].layout", message: "z" },
        { card_id: "gone", path: "cards[7].title", message: "w" },
      ],
      cards,
    );
    expect(out.page.map((p) => p.message)).toEqual(["x", "w"]);
    expect(out.byCard.get("b")).toEqual([{ rel: "data.measure.path", problem: expect.objectContaining({ message: "y" }) }]);
    expect(out.byCard.get("a")![0]!.rel).toBe("layout");
  });

  it("uses the localized name when present", () => {
    expect(localName({ name: "Total", names: { th: "ยอดรวม", zh: "" }, path: "h.total" }, "th")).toBe("ยอดรวม");
    expect(localName({ name: "Total", names: { zh: " " }, path: "h.total" }, "zh")).toBe("Total");
    expect(localName({ name: "", path: "h.total" })).toBe("h.total");
  });
});

describe("localizeReportError", () => {
  // every message report_config.py / report_service.py emits (contract §5 report_invalid)
  const BACKEND = [
    "period must be an object",
    "current_year takes no fixed dates",
    "period mode must be current_year or fixed",
    "a fixed period needs a valid from date (YYYY-MM-DD)",
    "a fixed period needs a valid to date (YYYY-MM-DD)",
    "the period ends before it starts",
    "grid must be an object",
    "the grid has 12 columns",
    "row height must be an integer from 20 to 400",
    "layout must be an object",
    "must be an integer",
    "x must be from 0 to 11",
    "y must be from 0 to 1000",
    "the card must fit the 12 grid columns",
    "h must be from 2 to 12",
    "style must be an object",
    "precision must be an integer from 0 to 6",
    "colors must be a list of at most 20 colors",
    "a color is #RRGGBB",
    "must be true or false",
    "axis must be an object",
    "must be text up to 200 characters",
    "a field path is required",
    "a field path is group.item or group.table.column",
    "a column can only be used from the selected table (table grain)",
    "a table grain measure must be a column of the selected table",
    "the field does not exist in the selected template versions",
    "the field is not in every selected version",
    "the field has different types in the selected versions",
    "a field of type date cannot be used here",
    "a card must be an object",
    "a card id is 1-64 letters, digits, _ or -",
    "card ids must be unique in the page",
    "type must be one of bar, line, pie, donut, metric, table",
    "title must be text up to 200 characters",
    "the card overlaps card card_x",
    "data must be an object",
    "a template is required",
    "the template is no longer available",
    "choose 1-20 distinct template versions",
    "the version is not available",
    "the version is of another template",
    "grain must be document or table",
    "a table grain needs a table (group.table)",
    "the table is not in every selected version",
    "a document grain takes no table",
    "a measure is required",
    "agg must be one of sum, avg, min, max, count",
    "count takes no field",
    "dimension must be an object",
    "kind must be date, category or none",
    "no dimension takes no field",
    "time grain must be day, month or year",
    "only a date dimension has a time grain",
    "a metric card has no dimension",
    "this chart needs a date or category dimension",
    "this chart has no series",
    "series must be an object or null",
    "the series must differ from the dimension",
    "date_field must be an object or null",
    "the measure needs a currency or unit",
    "a fixed unit is 1-16 characters",
    "unit mode must be fixed or field",
    "confirmed_paths must be a list of paths",
    "confirm that h.total means the same in every selected version",
    "the configuration must be an object",
    "configuration version must be 1",
    "cards must be a list",
    "a page has at most 30 cards",
    "add at least one card before publishing",
    "the configuration is larger than 256 KB",
  ];

  it.each(BACKEND)("localizes %s", (message) => {
    const labels = { ...DEFAULT_REPORT_ERROR_LABELS };
    for (const k of Object.keys(labels) as (keyof typeof labels)[]) {
      const v = labels[k];
      (labels as Record<string, unknown>)[k] = typeof v === "function" ? (...a: unknown[]) => `T:${k}:${a.join(",")}` : `T:${k}`;
    }
    expect(localizeReportError(message, labels)).toMatch(/^T:/);
  });

  it("keeps the arguments it needs", () => {
    expect(localizeReportError("the card overlaps card card_x")).toContain("card_x");
    expect(localizeReportError("confirm that h.total means the same in every selected version")).toContain("h.total");
  });

  it("passes unknown messages through unchanged", () => {
    expect(localizeReportError("some brand new thing", DEFAULT_REPORT_ERROR_LABELS)).toBe("some brand new thing");
  });
});
