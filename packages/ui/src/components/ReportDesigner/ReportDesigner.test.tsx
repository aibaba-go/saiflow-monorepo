import { act, render, screen, waitFor, within } from "@testing-library/react";
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
  it("keeps HTML selectable after selecting another card (FR-REPORT-020)", async () => {
    const initial: ReportConfig = { ...ONE, cards: [...ONE.cards, { id: "html", type: "html", title: "Embedded content", layout: { x: 6, y: 0, w: 6, h: 4 }, data: null, content: { mode: "html", html: "<p>Hello</p>" } }] };
    render(<Harness initial={initial} />);
    const html = await screen.findByRole("button", { name: "Embedded content" });
    await userEvent.click(html);
    await userEvent.click(screen.getByRole("button", { name: "Sales" }));
    expect(html).toHaveAttribute("aria-pressed", "false");
    const iframe = html.querySelector("iframe")!;
    expect(iframe).toHaveStyle({ pointerEvents: "none" });
    expect(iframe).toHaveAttribute("tabindex", "-1");
    await userEvent.click(iframe.parentElement!);
    expect(html).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("textbox", { name: "HTML" })).toBeInTheDocument();
    expect(iframe).toHaveAttribute("sandbox", "");
  });

  it("adds static HTML with a content editor instead of dataset bindings", async () => {
    const onConfig = vi.fn();
    render(<Harness initial={EMPTY} onConfig={onConfig} />);
    await userEvent.click(screen.getByRole("button", { name: L.add(L.chartTypes.html) }));
    const added = onConfig.mock.calls.at(-1)![0] as ReportConfig;
    expect(added.cards[0]?.data).toBeNull();
    expect(await screen.findByRole("textbox", { name: "HTML" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: L.template })).not.toBeInTheDocument();
  });

  it.each([{ origins: [] }, { origins: ["https://approved.example"] }])("explains the configured HTTPS page policy %j (FR-REPORT-020)", async ({ origins }) => {
    render(<Harness initial={EMPTY} embedOrigins={origins} />);
    await userEvent.click(screen.getByRole("button", { name: L.add(L.chartTypes.html) }));
    await userEvent.click(screen.getByRole("combobox", { name: "Content mode" }));
    await userEvent.click(await screen.findByText("Embedded HTTPS page", { selector: ".ant-select-item-option-content" }));
    expect(await screen.findByText(origins.length ? "Approved HTTPS origins: https://approved.example" : "No HTTPS origins are approved. Ask the administrator to configure the page origin before embedding it.")).toBeInTheDocument();
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

  it("configures raw display columns and page size without aggregation controls", async () => {
    const onConfig = vi.fn();
    const bound: ReportConfig = { ...ONE, cards: [{ ...ONE.cards[0]!, data: { template_id: 12, template_version_ids: [102], grain: "document", display_fields: [] } }] };
    render(<Harness initial={bound} onConfig={onConfig} />);
    await userEvent.click(await screen.findByRole("button", { name: "Sales" }));
    expect(await screen.findByRole("combobox", { name: "Display fields" })).toBeInTheDocument();
    expect(screen.queryByRole("combobox", { name: L.agg })).not.toBeInTheDocument();
    expect(screen.queryByRole("radiogroup", { name: L.dimension })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("combobox", { name: "Display fields" }));
    await userEvent.click(await screen.findByText("Total · Amount"));
    const config = onConfig.mock.calls.at(-1)![0] as ReportConfig;
    expect(config.cards[0]!.data!.display_fields).toEqual([{ path: "header.total", label: "Total" }]);
    const pageSize = screen.getByRole("spinbutton", { name: "Rows per page" });
    await userEvent.clear(pageSize);
    await userEvent.type(pageSize, "5");
    await userEvent.tab();
    expect((onConfig.mock.calls.at(-1)![0] as ReportConfig).cards[0]!.data!.page_size).toBe(5);
  });

  it("discovers SQL fields and configures a raw table without template grains", async () => {
    const onConfig = vi.fn();
    const querySource = vi.fn(async () => ({ columns: [{ key: "amount", label: "amount", type: "decimal" }], rows: [{ amount: "12.00" }], page: 1, page_size: 5, total: 1 }));
    render(<Harness initial={ONE} onConfig={onConfig} sources={[{ id: "postgres:1", name: "ERP", kind: "postgresql", enabled: true }]} querySource={querySource} />);
    await userEvent.click(await screen.findByRole("button", { name: "Sales" }));
    await userEvent.click(screen.getByRole("combobox", { name: "Data source" }));
    await userEvent.click(await screen.findByText("ERP · PostgreSQL"));
    expect(screen.queryByRole("combobox", { name: L.template })).not.toBeInTheDocument();
    expect(screen.queryByRole("group", { name: L.versions })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole("combobox", { name: "Query mode" }));
    await userEvent.click(await screen.findByText("Write SQL"));
    await userEvent.type(screen.getByRole("textbox", { name: "SQL" }), "SELECT amount FROM sales");
    await userEvent.click(screen.getByRole("button", { name: "Run and discover fields" }));
    expect(await screen.findByRole("combobox", { name: "Display fields" })).toBeInTheDocument();
    const config = onConfig.mock.calls.at(-1)![0] as ReportConfig;
    expect(config.cards[0]!.data).toMatchObject({ source_id: "postgres:1", sql: "SELECT amount FROM sales", result_fields: [{ key: "amount", label: "amount", type: "decimal" }] });
    expect(config.cards[0]!.data!.template_id).toBeUndefined();
    expect(screen.queryByRole("combobox", { name: L.grain })).not.toBeInTheDocument();
  });

  it("selects a database directly and replaces template bindings with typed query fields (FR-REPORT-023)", async () => {
    const onConfig = vi.fn();
    const initial: ReportConfig = { ...ONE, cards: [{ ...ONE.cards[0]!, data: { template_id: 12, template_version_ids: [102], grain: "document", display_fields: [{ path: "header.total", label: "Total" }], date_field: { path: "header.date" }, confirmed_paths: ["header.total"] } }] };
    render(<Harness initial={initial} onConfig={onConfig} sources={[
      { id: "postgres:1", name: "ERP", kind: "postgresql", enabled: true },
      { id: "postgres:2", name: "Disabled ERP", kind: "postgresql", enabled: false },
      { id: "system-pg", name: "System PG", kind: "system_pg", enabled: true },
    ]} loadTables={async () => [{ schema: "public", name: "sales", kind: "table" }]} querySource={async () => ({ columns: [{ key: "amount", label: "Amount", type: "decimal" }, { key: "posted", label: "Posted", type: "date" }], rows: [], page: 1, page_size: 20, total: 0 })} />);
    await userEvent.click(await screen.findByRole("button", { name: "Sales" }));
    await screen.findByRole("combobox", { name: "Display fields" });
    await userEvent.click(screen.getByRole("combobox", { name: "Data source" }));
    expect(await screen.findByText("ERP · PostgreSQL")).toBeInTheDocument();
    expect(screen.queryByText("Disabled ERP · PostgreSQL")).toBeNull();
    expect(screen.queryByText("System PG")).toBeNull();
    await userEvent.click(screen.getByText("ERP · PostgreSQL"));
    expect((onConfig.mock.calls.at(-1)![0] as ReportConfig).cards[0]!.data).toEqual({ source_id: "postgres:1", query_mode: "table", sql: "", result_fields: [], display_fields: [], page_size: 20 });
    expect(screen.queryByRole("combobox", { name: L.template })).toBeNull();
    expect(screen.queryByRole("combobox", { name: L.grain })).toBeNull();
    expect(screen.queryByText(L.versions)).toBeNull();
    expect(screen.queryByRole("combobox", { name: "Display fields" })).toBeNull();
    await userEvent.click(screen.getByRole("combobox", { name: "Table or view" }));
    await userEvent.click(await screen.findByText("public.sales · table"));
    await userEvent.click(screen.getByRole("button", { name: "Run and discover fields" }));
    expect(await screen.findByRole("combobox", { name: "Display fields" })).toBeInTheDocument();
    expect(screen.getByLabelText("Column label 1")).toHaveValue("Amount");
    expect(screen.getByLabelText("Column label 2")).toHaveValue("Posted");
    expect(screen.queryByText(/header.total/)).toBeNull();
    await userEvent.click(screen.getByRole("combobox", { name: "Data source" }));
    await userEvent.click(await screen.findByText("Document template"));
    expect(screen.getByRole("combobox", { name: L.template })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "SQL" })).toBeNull();
    expect((onConfig.mock.calls.at(-1)![0] as ReportConfig).cards[0]!.data!.source_id).toBeUndefined();
  });

  it("selects a quoted relation, persists table mode and clears fields when switching modes (FR-DATA-003)", async () => {
    const onConfig = vi.fn();
    const initial: ReportConfig = { ...ONE, cards: [{ ...ONE.cards[0]!, data: { source_id: "postgres:1", sql: "", query_mode: "sql" } }] };
    render(<Harness initial={initial} onConfig={onConfig} loadTables={async () => [{ schema: 'Sales"East', name: "Orders", kind: "table" }]} querySource={async () => ({ columns: [{ key: "amount", label: "Amount", type: "decimal" }], rows: [], page: 1, page_size: 20, total: 0 })} />);
    await userEvent.click(await screen.findByRole("button", { name: "Sales" }));
    await userEvent.click(screen.getByRole("combobox", { name: "Query mode" }));
    await userEvent.click(await screen.findByText("Select table"));
    await userEvent.click(screen.getByRole("combobox", { name: "Table or view" }));
    await userEvent.click(await screen.findByText('Sales"East.Orders · table'));
    const sql = 'SELECT * FROM "Sales""East"."Orders"';
    expect(screen.getByRole("textbox", { name: "SQL" })).toHaveValue(sql);
    expect(screen.getByRole("textbox", { name: "SQL" })).toHaveAttribute("readonly");
    await userEvent.click(screen.getByRole("button", { name: "Run and discover fields" }));
    await screen.findByText(/Result fields discovered/);
    expect((onConfig.mock.calls.at(-1)![0] as ReportConfig).cards[0]!.data).toMatchObject({ query_mode: "table", relation: { schema: 'Sales"East', name: "Orders" }, sql, result_fields: [{ key: "amount", label: "Amount", type: "decimal" }] });
    await userEvent.click(screen.getByRole("combobox", { name: "Query mode" }));
    await userEvent.click(await screen.findByText("Write SQL"));
    expect((onConfig.mock.calls.at(-1)![0] as ReportConfig).cards[0]!.data).toMatchObject({ query_mode: "sql", result_fields: [], display_fields: [] });
    expect(screen.getByRole("textbox", { name: "SQL" })).not.toHaveAttribute("readonly");
  });

  it("explains an empty database catalog without hiding the template path (FR-REPORT-023)", async () => {
    render(<Harness initial={ONE} sources={[]} />);
    await userEvent.click(await screen.findByRole("button", { name: "Sales" }));
    expect(screen.getByText("No enabled PostgreSQL sources. Add a connection in Data sources; document templates remain available.")).toBeInTheDocument();
    expect(screen.getByRole("combobox", { name: L.template })).toBeInTheDocument();
  });

  it("disables field discovery until a database is selected (FR-DATA-003)", async () => {
    const initial: ReportConfig = { ...ONE, cards: [{ ...ONE.cards[0]!, data: { query_mode: "sql", sql: "SELECT 1" } }] };
    render(<Harness initial={initial} querySource={async () => { throw new Error("No source"); }} />);
    await userEvent.click(await screen.findByRole("button", { name: "Sales" }));
    expect(screen.getByRole("button", { name: "Run and discover fields" })).toBeDisabled();
  });

  it("retries a failed catalog and ignores a late response after changing database (FR-DATA-003)", async () => {
    let resolve!: (items: { schema: string; name: string; kind: "table" }[]) => void;
    let attempt = 0;
    const old = new Promise<Parameters<typeof resolve>[0]>(r => { resolve = r; });
    const loadTables = async (id: string) => {
      if (id === "postgres:2") return [{ schema: "public", name: "New orders", kind: "table" as const }];
      if (++attempt === 1) throw new Error("Connection unavailable");
      return old;
    };
    const initial: ReportConfig = { ...ONE, cards: [{ ...ONE.cards[0]!, data: { source_id: "postgres:1", query_mode: "table", sql: "" } }] };
    render(<Harness initial={initial} loadTables={loadTables} sources={[{ id: "postgres:1", name: "Old ERP", kind: "postgresql", enabled: true }, { id: "postgres:2", name: "New ERP", kind: "postgresql", enabled: true }]} />);
    await userEvent.click(await screen.findByRole("button", { name: "Sales" }));
    expect(await screen.findByText("Tables could not be loaded. Check source permissions and connection.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Reload tables" }));
    await userEvent.click(screen.getByRole("combobox", { name: "Data source" }));
    await userEvent.click(await screen.findByText("New ERP · PostgreSQL"));
    await userEvent.click(screen.getByRole("combobox", { name: "Table or view" }));
    expect(await screen.findByText("public.New orders · table")).toBeInTheDocument();
    await act(async () => resolve([{ schema: "public", name: "Stale orders", kind: "table" }]));
    expect(screen.queryByText("public.Stale orders · table")).not.toBeInTheDocument();
    expect(screen.queryByText("Tables could not be loaded. Check source permissions and connection.")).not.toBeInTheDocument();
  });

  it("keeps title edits made while SQL field discovery is pending", async () => {
    let resolve!: (value: { columns: { key: string; label: string; type: string }[]; rows: []; page: number; page_size: number; total: number }) => void;
    const pending = new Promise<Parameters<typeof resolve>[0]>((r) => { resolve = r; });
    const onConfig = vi.fn();
    const bound: ReportConfig = { ...ONE, cards: [{ ...ONE.cards[0]!, data: { source_id: "postgres:1", sql: "SELECT amount FROM sales" } }] };
    render(<Harness initial={bound} onConfig={onConfig} querySource={async () => pending} />);
    await userEvent.click(await screen.findByRole("button", { name: "Sales" }));
    await userEvent.click(screen.getByRole("button", { name: "Run and discover fields" }));
    await userEvent.type(screen.getByLabelText(L.cardTitle), " updated");
    await act(async () => resolve({ columns: [{ key: "amount", label: "Amount", type: "decimal" }], rows: [], page: 1, page_size: 5, total: 0 }));
    expect((onConfig.mock.calls.at(-1)![0] as ReportConfig).cards[0]!.title).toBe("Sales updated");
  });

  it("does not accept fields from a SQL query after switching to a template", async () => {
    let resolve!: (value: { columns: { key: string; label: string; type: string }[]; rows: []; page: number; page_size: number; total: number }) => void;
    const pending = new Promise<Parameters<typeof resolve>[0]>((r) => { resolve = r; });
    const onConfig = vi.fn();
    const bound: ReportConfig = { ...ONE, cards: [{ ...ONE.cards[0]!, data: { source_id: "postgres:1", sql: "SELECT amount FROM sales" } }] };
    render(<Harness initial={bound} onConfig={onConfig} querySource={async () => pending} />);
    await userEvent.click(await screen.findByRole("button", { name: "Sales" }));
    await userEvent.click(screen.getByRole("button", { name: "Run and discover fields" }));
    await userEvent.click(screen.getByRole("combobox", { name: "Data source" }));
    await userEvent.click(await screen.findByText("Document template"));
    await act(async () => resolve({ columns: [{ key: "amount", label: "Amount", type: "decimal" }], rows: [], page: 1, page_size: 5, total: 0 }));
    expect((onConfig.mock.calls.at(-1)![0] as ReportConfig).cards[0]!.data?.source_id).toBeUndefined();
    expect(screen.queryByRole("textbox", { name: "SQL" })).not.toBeInTheDocument();
  });

  it("forwards raw preview pagination without editing the report definition", async () => {
    const onConfig = vi.fn();
    const onPreviewPage = vi.fn();
    const preview: QueryResult = { report_version: null, generated_at: "2026-11-22T00:00:00Z", period: { from: "2026-01-01", to: "2026-12-31" }, scope: "own", synthetic: false, cards: [{ card_id: "c1", status: "ok", rows: [], table: { columns: [{ key: "amount", label: "Amount", type: "decimal" }], rows: [{ amount: "12.00" }], page: 1, page_size: 5, total: 6 } }] };
    render(<Harness initial={ONE} preview={preview} onPreviewPage={onPreviewPage} onConfig={onConfig} />);
    await userEvent.click(await screen.findByRole("button", { name: "Next page" }));
    expect(onPreviewPage).toHaveBeenCalledWith("c1", 2);
    expect(onConfig).not.toHaveBeenCalled();
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
      cards: [{ ...ONE.cards[0]!, type: "bar", data: { template_id: 12, template_version_ids: [102], grain: "document" } }],
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
