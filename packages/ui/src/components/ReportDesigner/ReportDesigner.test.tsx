import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import type { QueryResult, ReportConfig } from "../reportTypes";
import { ReportDesigner, type ReportDesignerProps } from "./ReportDesigner";
import { DEFAULT_REPORT_DESIGNER_LABELS as L } from "./labels";
import type { DesignerFields, DesignerTemplate } from "./model";

const TEMPLATES: DesignerTemplate[] = [
  {
    template_id: 12,
    code: "invoice",
    name: "Invoice",
    scope: "tenant",
    usable: true,
    versions: [
      { id: 101, version: 1, name: "First", current: false },
      { id: 102, version: 2, name: "Second", current: true },
    ],
  },
];
const FIELDS: DesignerFields = {
  grains: [{ grain: "document", versions: [102], compatible: true }],
  fields: [
    { path: "header.total", name: "Total", type: "amount", grain: "document", versions: [102], compatible: true },
    { path: "header.date", name: "Date", type: "date", grain: "document", versions: [102], compatible: true },
    { path: "header.branch", name: "Branch", type: "string", grain: "document", versions: [102], compatible: true },
  ],
};

const EMPTY: ReportConfig = { version: 1, period: { mode: "current_year" }, grid: { cols: 12, row_height: 80 }, cards: [] };
const ONE: ReportConfig = {
  ...EMPTY,
  cards: [{ id: "c1", type: "table", title: "Sales", layout: { x: 0, y: 0, w: 6, h: 4 }, data: {}, style: {} }],
};

/** The designer as an app uses it: controlled, keeping every change. */
function Harness({ initial, onConfig, ...rest }: Partial<ReportDesignerProps> & { initial: ReportConfig; onConfig?: (c: ReportConfig) => void }) {
  const [value, setValue] = useState(initial);
  return (
    <ReportDesigner
      templates={TEMPLATES}
      loadFields={async () => FIELDS}
      {...rest}
      value={value}
      onChange={(next) => {
        setValue(next);
        onConfig?.(next);
      }}
    />
  );
}

describe("ReportDesigner (FR-REPORT-005, -006, -013, -014)", () => {
  it("adds static HTML with a content editor instead of dataset bindings", async () => {
    const onConfig = vi.fn();
    render(<Harness initial={EMPTY} onConfig={onConfig} />);
    await userEvent.click(screen.getByRole("button", { name: L.add(L.chartTypes.html) }));
    const added = onConfig.mock.calls.at(-1)![0] as ReportConfig;
    expect(added.cards[0]?.data).toBeNull();
    expect(await screen.findByRole("textbox", { name: "HTML" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: L.template })).not.toBeInTheDocument();
  });

  it("adds a card from the palette and opens its panel", async () => {
    const onConfig = vi.fn();
    render(<Harness initial={EMPTY} onConfig={onConfig} />);
    expect(screen.getByText(L.emptyCanvas)).toBeInTheDocument();
    expect(screen.getByRole("region", { name: L.pagePanel })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: L.add(L.chartTypes.bar) }));
    const added = onConfig.mock.calls.at(-1)![0] as ReportConfig;
    expect(added.cards).toHaveLength(1);
    expect(added.cards[0]).toMatchObject({ type: "bar", layout: { x: 0, y: 0, w: 6, h: 4 } });
    expect(await screen.findByRole("region", { name: L.cardPanel })).toBeInTheDocument();
  });

  it.each(["bar", "line", "pie", "donut", "metric", "table"] as const)("keeps the %s palette tile accessible with a decorative chart icon", async (type) => {
    const onConfig = vi.fn();
    render(<Harness initial={EMPTY} onConfig={onConfig} />);
    const tile = screen.getByRole("button", { name: L.add(L.chartTypes[type]) });
    expect(tile.querySelector("svg")).toHaveAttribute("aria-hidden", "true");
    await userEvent.click(tile);
    const added = onConfig.mock.calls.at(-1)![0] as ReportConfig;
    expect(added.cards[0]?.type).toBe(type);
    expect(await screen.findByRole("region", { name: L.cardPanel })).toBeInTheDocument();
  });

  it("binds a template on its current version and loads that version's fields", async () => {
    const loadFields = vi.fn(async () => FIELDS);
    const onConfig = vi.fn();
    render(<Harness initial={ONE} onConfig={onConfig} loadFields={loadFields} />);
    await userEvent.click(await screen.findByRole("button", { name: "Sales" }));
    const panel = await screen.findByRole("region", { name: L.cardPanel });
    await userEvent.click(within(panel).getByRole("combobox", { name: L.template }));
    await userEvent.click(await screen.findByText(`Invoice (invoice) · ${L.scopes.tenant}`));
    await waitFor(() => expect(loadFields).toHaveBeenCalledWith(12, [102]));
    const bound = onConfig.mock.calls.at(-1)![0] as ReportConfig;
    expect(bound.cards[0]!.data).toMatchObject({ template_id: 12, template_version_ids: [102] });
    // the version list shows both, the current one marked
    expect(within(panel).getByRole("checkbox", { name: /v2 · Second/ })).toBeChecked();
    expect(within(panel).getByRole("checkbox", { name: /v1 · First/ })).not.toBeChecked();
    expect(await within(panel).findByRole("combobox", { name: L.grain })).toBeInTheDocument();
  });

  it("explains a failed field load with a retry", async () => {
    let fail = true;
    const loadFields = vi.fn(async () => {
      if (fail) throw new Error("down");
      return FIELDS;
    });
    const bound: ReportConfig = { ...ONE, cards: [{ ...ONE.cards[0]!, data: { template_id: 12, template_version_ids: [102] } }] };
    render(<Harness initial={bound} loadFields={loadFields} />);
    await userEvent.click(await screen.findByRole("button", { name: "Sales" }));
    expect(await screen.findByText(L.fieldsFailed)).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: L.retry }));
    expect(await screen.findByRole("combobox", { name: L.grain })).toBeInTheDocument();
    expect(loadFields).toHaveBeenCalledTimes(2);
  });

  it("shows a count with no decimals and restores them when it stops being a count", async () => {
    const onConfig = vi.fn();
    const bound: ReportConfig = {
      ...ONE,
      cards: [{ ...ONE.cards[0]!, data: { template_id: 12, template_version_ids: [102], grain: "document" } }],
    };
    render(<Harness initial={bound} onConfig={onConfig} />);
    await userEvent.click(await screen.findByRole("button", { name: "Sales" }));
    const panel = await screen.findByRole("region", { name: L.cardPanel });
    const pick = async (label: string) => {
      await userEvent.click(await within(panel).findByRole("combobox", { name: L.agg }));
      const options = await screen.findAllByRole("option", { name: label });
      await userEvent.click(options.at(-1)!);
    };
    await pick(L.aggs.count);
    let card = (onConfig.mock.calls.at(-1)![0] as ReportConfig).cards[0]!;
    expect(card.style?.precision).toBe(0);
    expect(card.data?.measure).toMatchObject({ agg: "count", path: null });
    await pick(L.aggs.sum);
    card = (onConfig.mock.calls.at(-1)![0] as ReportConfig).cards[0]!;
    expect(card.style?.precision).toBe(2);
    expect(card.data?.measure?.agg).toBe("sum");
  });

  it("summarises the problems and leads to the card that has them", async () => {
    render(
      <Harness
        initial={ONE}
        errors={[
          { card_id: null, path: "period.from", message: "period.from is required for a fixed period" },
          { card_id: "c1", path: "cards[0].data.template_id", message: "a template is required" },
        ]}
      />,
    );
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent(L.errorSummary(2));
    await userEvent.click(within(alert).getByRole("button", { name: L.cardProblems("Sales", 1) }));
    const panel = await screen.findByRole("region", { name: L.cardPanel });
    const explain = panel.querySelector(".ant-form-item-explain-error");
    expect(explain).toHaveTextContent(L.errors.needTemplate);
  });

  it("marks problems of an older configuration as stale", () => {
    render(<Harness initial={ONE} errors={[{ card_id: "c1", path: "cards[0].data.template_id", message: "a template is required" }]} errorsStale />);
    expect(screen.getByRole("alert")).toHaveTextContent(L.errorsStale);
  });

  it("labels a synthetic preview and an outdated one", async () => {
    const preview: QueryResult = {
      generated_at: "2026-11-11T00:00:00Z",
      period: { from: "2026-01-01", to: "2026-12-31" },
      scope: "synthetic",
      synthetic: true,
      report_version: null,
      cards: [{ card_id: "c1", status: "ok", rows: [{ dimension: "A", series: null, unit: null, value: "1", count: 1 }] }],
    };
    render(<Harness initial={ONE} preview={preview} previewStale />);
    expect(screen.getByText(L.previewSynthetic)).toBeInTheDocument();
    expect(screen.getByText(L.previewStale)).toBeInTheDocument();
    // the grid is loaded lazily; the card (no dimension) then shows the previewed value
    expect(await screen.findByRole("cell", { name: "1.00" }, { timeout: 5000 })).toBeInTheDocument();
  });

  it("read-only shows no palette and changes nothing", async () => {
    const onConfig = vi.fn();
    render(<Harness initial={ONE} readOnly onConfig={onConfig} />);
    expect(screen.queryByRole("navigation", { name: L.palette })).toBeNull();
    expect(screen.getByRole("region", { name: L.pagePanel })).toBeInTheDocument();
    expect(onConfig).not.toHaveBeenCalled();
  });
});
