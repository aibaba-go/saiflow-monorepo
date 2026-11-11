import { screen, waitFor, within } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReportDetail, ReportSummary } from "../reports/api";
import { useLanguage } from "../stores/language";
import { en, renderAt, signedIn, userEvent } from "../test/app";
import { ORG, PERSONAL, type UsableTenant } from "../test/fixtures";
import { json } from "../test/mockApi";
import { useTenantChoice } from "../tenants/useCurrentTenant";

const LONG = 30_000;
const WAIT = { timeout: 10_000 };
const T0 = "2026-11-01T03:00:00Z";
const USAGE = {
  plan: { code: "starter", period: "month", starts_at: T0, ends_at: "2026-12-01T03:00:00Z" },
  active: true,
  month: { month: "2026-11-01", quota: 5000, used: 0, remaining: 5000 },
  free: { remaining: 0, expires_at: null, paused: false },
};
const KINDER = { ...USAGE, plan: { ...USAGE.plan, code: "kinder" } };

const VIEWER: UsableTenant = { ...ORG, permissions: ["upload_ocr", "verify_own", "report_view", "export"] };
const VIEWER_NO_EXPORT: UsableTenant = { ...ORG, permissions: ["upload_ocr", "report_view"] };
const DESIGNER: UsableTenant = { ...ORG, permissions: ["report_manage", "report_view"] };

const LIST = "GET /api/v1/reports";
const ONE = "GET /api/v1/reports/31";
const DATA = "POST /api/v1/reports/31/data";
const CSV = "GET /api/v1/reports/31/csv";
const USAGE_ROUTE = "GET /api/v1/billing/usage";

const CONFIG = {
  version: 1,
  period: { mode: "current_year" },
  grid: { cols: 12, row_height: 80 },
  cards: [
    {
      id: "c1",
      type: "table",
      title: "Sales by branch",
      layout: { x: 0, y: 0, w: 6, h: 4 },
      data: {
        template_id: 12,
        template_version_ids: [101],
        grain: "document",
        measure: { path: "header.total", agg: "sum" },
        dimension: { kind: "category", path: "header.branch" },
        date_field: { path: "header.date" },
        unit: { mode: "fixed", value: "THB" },
      },
      style: { precision: 2 },
    },
  ],
};

const RESULT = (over: Record<string, unknown> = {}) => ({
  generated_at: "2026-11-11T02:00:00Z",
  period: { from: "2026-01-01", to: "2026-12-31" },
  scope: "own",
  synthetic: false,
  report_version: 2,
  cards: [
    {
      card_id: "c1",
      status: "ok",
      period_applied: true,
      rows: [
        { dimension: "Bangkok", series: null, unit: "THB", value: "1500.5", count: 3 },
        { dimension: "Chiang Mai", series: null, unit: "THB", value: "200", count: 1 },
      ],
      diagnostics: { documents: 4, excluded: { invalid_number: 1 } },
    },
  ],
  ...over,
});

const detail = (over: Partial<ReportDetail> = {}): ReportDetail => ({
  id: 31,
  tenant_id: 5,
  name: "Sales overview",
  status: "published",
  revision: 4,
  can_manage: false,
  can_export: true,
  created_at: T0,
  updated_at: T0,
  draft: null,
  draft_errors: [],
  published: { name: "Sales overview", config: CONFIG, published_at: "2026-11-10T03:00:00Z", version: 2 },
  sources: [{ template_id: 12, name: "Invoice", versions: [{ id: 101, version: 1 }] }],
  ...over,
});

const summary = (over: Partial<ReportSummary> = {}): ReportSummary => ({
  id: 31,
  name: "Sales overview",
  status: "published",
  revision: 4,
  can_manage: false,
  published_version: 2,
  published_at: "2026-11-10T03:00:00Z",
  updated_at: T0,
  ...over,
});

function inOrg(tenant: UsableTenant, routes: Parameters<typeof signedIn>[0] = {}, usage: unknown = USAGE) {
  return signedIn({ [USAGE_ROUTE]: () => json(200, usage), ...routes }, { tenants: [PERSONAL, tenant] });
}

const menuLinks = async () =>
  within(await screen.findByRole("menu", {}, WAIT))
    .getAllByRole("link")
    .map((a) => a.textContent);

beforeEach(() => {
  localStorage.clear();
  useLanguage.getState().setLang("en");
  localStorage.setItem("saiflow.pc.tenant.7", "5");
  useTenantChoice.getState().reset();
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("report menu and gate (FR-SYS-141)", () => {
  it(
    "shows the menu item and the published list to a report_view holder on Starter",
    async () => {
      inOrg(VIEWER, { [LIST]: () => json(200, { items: [summary()] }) });
      renderAt("/reports");
      const row = (await screen.findByText("Sales overview", {}, WAIT)).closest("tr") as HTMLElement;
      expect(await menuLinks()).toContain(en("nav.reports"));
      expect(within(row).getByText(en("rpt.status.published"))).toBeInTheDocument();
      expect(within(row).getByText(/v2/)).toBeInTheDocument();
      expect(within(row).getByRole("button", { name: en("rpt.open") })).toBeInTheDocument();
      expect(within(row).queryByRole("button", { name: en("rpt.design") })).toBeNull();
      expect(screen.queryByRole("button", { name: en("rpt.new") })).toBeNull();
    },
    LONG,
  );

  it(
    "hides it without a report permission and never asks for the plan",
    async () => {
      const api = inOrg(ORG, { [LIST]: () => json(200, { items: [] }) });
      renderAt("/reports");
      expect(await screen.findByText(en("rpt.noView"), {}, WAIT)).toBeInTheDocument();
      expect(await menuLinks()).not.toContain(en("nav.reports"));
      expect(api.count(USAGE_ROUTE)).toBe(0);
      expect(api.count(LIST)).toBe(0);
    },
    LONG,
  );

  it(
    "refuses a plan below Starter even with the permission",
    async () => {
      const api = inOrg(VIEWER, { [LIST]: () => json(200, { items: [] }) }, KINDER);
      renderAt("/reports");
      expect(await screen.findByText(en("rpt.unavailableBody"), {}, WAIT)).toBeInTheDocument();
      expect(await menuLinks()).not.toContain(en("nav.reports"));
      expect(api.count(LIST)).toBe(0);
    },
    LONG,
  );

  it(
    "refuses the personal account",
    async () => {
      localStorage.clear();
      useTenantChoice.getState().reset();
      const api = signedIn({ [LIST]: () => json(200, { items: [] }) });
      renderAt("/reports");
      expect(await screen.findByText(en("rpt.unavailable"), {}, WAIT)).toBeInTheDocument();
      expect(api.count(USAGE_ROUTE)).toBe(0);
    },
    LONG,
  );

  it(
    "lets a viewer without report_manage not open the designer",
    async () => {
      inOrg(VIEWER, { [ONE]: () => json(200, detail()) });
      renderAt("/reports/31/design");
      expect(await screen.findByText(en("rpt.noManage"), {}, WAIT)).toBeInTheDocument();
    },
    LONG,
  );

  it(
    "gives a designer the New button and creates a report",
    async () => {
      const created = detail({ id: 32, name: "Q4", status: "draft", published: null, draft: { version: 1, cards: [] }, can_manage: true, sources: [] });
      const api = inOrg(DESIGNER, {
        [LIST]: () => json(200, { items: [summary({ can_manage: true, status: "changed" })] }),
        "POST /api/v1/reports": () => json(201, created),
        "GET /api/v1/reports/32": () => json(200, created),
        "GET /api/v1/reports/catalog/templates": () => json(200, { items: [] }),
      });
      renderAt("/reports");
      const row = (await screen.findByText("Sales overview", {}, WAIT)).closest("tr") as HTMLElement;
      expect(within(row).getByText(en("rpt.status.changed"))).toBeInTheDocument();
      expect(within(row).getByRole("button", { name: en("rpt.design") })).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: en("rpt.new") }));
      const dialog = await screen.findByRole("dialog", {}, WAIT);
      await userEvent.type(within(dialog).getByRole("textbox"), "  Q4  ");
      await userEvent.click(within(dialog).getByRole("button", { name: en("rpt.create") }));
      expect(await api.bodies("POST /api/v1/reports")).toEqual([{ name: "Q4" }]);
      expect(await screen.findByRole("region", { name: en("rpt.designer") }, WAIT)).toBeInTheDocument();
    },
    LONG,
  );
});

describe("published report view (FR-REPORT-002, -010, -015, -016)", () => {
  it(
    "queries on open and shows the period, scope, source and counts",
    async () => {
      const api = inOrg(VIEWER, { [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()) });
      renderAt("/reports/31");
      expect(await screen.findByRole("rowheader", { name: "Bangkok" }, WAIT)).toBeInTheDocument();
      expect(await api.bodies(DATA)).toEqual([{ period: null, refresh: false }]);
      const bar = screen.getByRole("region", { name: en("rpt.periodBar") });
      expect(within(bar).getByText(/2026-01-01 – 2026-12-31/)).toBeInTheDocument();
      expect(within(bar).getByText(en("rpt.scope.own"))).toBeInTheDocument();
      expect(within(bar).getByText(en("rpt.noAutoRefresh"))).toBeInTheDocument();
      // the template and its versions, and what was counted / excluded (FR-REPORT-002)
      expect(screen.getAllByText(/Invoice/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/v1/).length).toBeGreaterThan(0);
      expect(screen.getAllByText(/4 documents · 1 excluded/).length).toBeGreaterThan(0);
      expect(screen.queryByRole("button", { name: en("rpt.design") })).toBeNull();
    },
    LONG,
  );

  it(
    "refreshes on demand only; a failed refresh keeps the old result marked stale",
    async () => {
      const api = inOrg(VIEWER, { [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()) });
      renderAt("/reports/31");
      await screen.findByRole("rowheader", { name: "Bangkok" }, WAIT);
      api.set(DATA, () => json(503, { code: "unavailable", message_key: "error.unavailable" }));
      await userEvent.click(screen.getByRole("button", { name: en("rpt.refresh") }));
      expect(await screen.findByText(en("rpt.staleTitle"), {}, WAIT)).toBeInTheDocument();
      expect(await api.bodies(DATA)).toEqual([
        { period: null, refresh: false },
        { period: null, refresh: true },
      ]);
      // the previous data stays readable, and CSV of a stale result is not offered
      expect(screen.getByRole("rowheader", { name: "Bangkok" })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: en("rpt.csvOf", { title: "Sales by branch" }) })).toBeDisabled();

      api.set(DATA, () => json(200, RESULT({ generated_at: "2026-11-11T03:00:00Z" })));
      await userEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: en("common.retry") }));
      await waitFor(() => expect(screen.queryByText(en("rpt.staleTitle"))).toBeNull(), WAIT);
      expect(screen.getByRole("button", { name: en("rpt.csvOf", { title: "Sales by branch" }) })).toBeEnabled();
    },
    LONG,
  );

  it.each([401, 403, 404])(
    "clears previous statistics after a refresh is refused with %s (003, SYS-141-03)",
    async (status) => {
      const api = inOrg(VIEWER, { [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()) });
      renderAt("/reports/31");
      await screen.findByRole("rowheader", { name: "Bangkok" }, WAIT);
      api.set(DATA, () => json(status, { code: "permission_denied", message_key: "error.permission_denied" }));
      await userEvent.click(screen.getByRole("button", { name: en("rpt.refresh") }));
      await waitFor(() => expect(screen.queryByRole("rowheader", { name: "Bangkok" })).toBeNull(), WAIT);
      expect(screen.queryByText(en("rpt.staleTitle"))).toBeNull();
      expect(screen.queryByText(/4 documents · 1 excluded/)).toBeNull();
      expect(screen.queryByRole("button", { name: en("rpt.csvOf", { title: "Sales by branch" }) })).toBeNull();
    },
    LONG,
  );

  it("reloads the matching published configuration before showing a new snapshot's values", async () => {
    const api = inOrg(VIEWER, { [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()) });
    renderAt("/reports/31");
    await screen.findByRole("rowheader", { name: "Bangkok" }, WAIT);
    const nextConfig = { ...CONFIG, cards: [{ ...CONFIG.cards[0], title: "Average by branch", data: { ...CONFIG.cards[0]!.data, measure: { path: "header.total", agg: "avg" } } }] };
    api.set(ONE, () => json(200, detail({ published: { name: "New overview", version: 3, published_at: T0, config: nextConfig } })));
    api.set(DATA, () => json(200, RESULT({ report_version: 3 })));
    await userEvent.click(screen.getByRole("button", { name: en("rpt.refresh") }));
    expect(await screen.findByRole("heading", { name: "New overview" }, WAIT)).toBeInTheDocument();
    expect(await screen.findByRole("rowheader", { name: "Bangkok" }, WAIT)).toBeInTheDocument();
    expect(screen.queryByText("Sales by branch")).toBeNull();
    expect(api.count(ONE)).toBe(2);
  }, LONG);

  it("clears old values and pending CSV when metadata advances before the statistics", async () => {
    const created = vi.fn(() => "blob:old-version");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }));
    let finishData!: (response: Response) => void;
    let finishCsv!: (response: Response) => void;
    const api = inOrg(VIEWER, {
      [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()),
      [CSV]: () => new Promise<Response>((resolve) => { finishCsv = resolve; }),
    });
    const { queryClient } = renderAt("/reports/31");
    await screen.findByRole("rowheader", { name: "Bangkok" }, WAIT);
    await userEvent.click(screen.getByRole("button", { name: en("rpt.csvOf", { title: "Sales by branch" }) }));
    await waitFor(() => expect(finishCsv).toBeTypeOf("function"), WAIT);
    const nextConfig = { ...CONFIG, cards: [{ ...CONFIG.cards[0], title: "Average by branch" }] };
    api.set(ONE, () => json(200, detail({ published: { name: "New overview", version: 3, published_at: T0, config: nextConfig } })));
    api.set(DATA, () => new Promise<Response>((resolve) => { finishData = resolve; }));
    await act(async () => { await queryClient.refetchQueries({ queryKey: ["report", 5, 31], exact: true }); });
    await screen.findByRole("heading", { name: "New overview" }, WAIT);
    await waitFor(() => expect(finishData).toBeTypeOf("function"), WAIT);
    expect(screen.queryByRole("rowheader", { name: "Bangkok" })).toBeNull();
    expect(screen.queryByText(/4 documents · 1 excluded/)).toBeNull();
    await act(async () => { finishCsv(new Response("category,value\nOld snapshot,100\n", { status: 200 })); });
    expect(created).not.toHaveBeenCalled();
    await act(async () => { finishData(json(503, { code: "unavailable", message_key: "error.unavailable" })); });
    await screen.findByText(en("rpt.loadFailed"), {}, WAIT);
    expect(screen.queryByRole("rowheader", { name: "Bangkok" })).toBeNull();
    expect(screen.queryByText(en("rpt.staleTitle"))).toBeNull();
    api.set(DATA, () => json(200, RESULT({ report_version: 3 })));
    await userEvent.click(screen.getByRole("button", { name: en("common.retry") }));
    expect(await screen.findByRole("rowheader", { name: "Bangkok" }, WAIT)).toBeInTheDocument();
  }, LONG);

  it("preserves the selected period across metadata changes and ignores old request cleanup", async () => {
    const created = vi.fn(() => "blob:new-version");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }));
    let finishOldData!: (response: Response) => void;
    let finishOldCsv!: (response: Response) => void;
    let finishNewCsv!: (response: Response) => void;
    const answer = async (r: Request, version = 2) => {
      const body = (await r.json()) as { period: { from: string; to: string } | null };
      return json(200, RESULT({ report_version: version, ...(body.period ? { period: body.period } : {}) }));
    };
    const api = inOrg(VIEWER, { [ONE]: () => json(200, detail()), [DATA]: (r) => answer(r) });
    const { queryClient } = renderAt("/reports/31");
    await screen.findByRole("rowheader", { name: "Bangkok" }, WAIT);
    const bar = screen.getByRole("region", { name: en("rpt.periodBar") });
    await userEvent.click(within(bar).getByPlaceholderText(en("rpt.periodFrom")));
    await userEvent.keyboard("2026-03-01{Enter}");
    await userEvent.keyboard("2026-03-31{Enter}");
    await userEvent.click(within(bar).getByRole("button", { name: en("rpt.applyPeriod") }));
    await screen.findByText("2026-03-01 – 2026-03-31", {}, WAIT);
    api.set(CSV, () => new Promise<Response>((resolve) => { finishOldCsv = resolve; }));
    await userEvent.click(screen.getByRole("button", { name: en("rpt.csvOf", { title: "Sales by branch" }) }));
    await waitFor(() => expect(finishOldCsv).toBeTypeOf("function"), WAIT);
    api.set(DATA, () => new Promise<Response>((resolve) => { finishOldData = resolve; }));
    await userEvent.click(screen.getByRole("button", { name: en("rpt.refresh") }));
    await waitFor(() => expect(finishOldData).toBeTypeOf("function"), WAIT);
    // The loading icon must not change the operation's accessible name.
    expect(screen.getByRole("button", { name: en("rpt.refresh") })).toHaveAccessibleName(en("rpt.refresh"));
    const nextConfig = { ...CONFIG, cards: [{ ...CONFIG.cards[0], title: "Average by branch" }] };
    api.set(ONE, () => json(200, detail({ published: { name: "New overview", version: 3, published_at: T0, config: nextConfig } })));
    api.set(DATA, (r) => answer(r, 3));
    await act(async () => { await queryClient.refetchQueries({ queryKey: ["report", 5, 31], exact: true }); });
    await screen.findByRole("heading", { name: "New overview" }, WAIT);
    await screen.findByRole("rowheader", { name: "Bangkok" }, WAIT);
    expect((await api.bodies(DATA)).at(-1)).toEqual({ period: { from: "2026-03-01", to: "2026-03-31" }, refresh: false });
    expect(within(bar).getByPlaceholderText(en("rpt.periodFrom"))).toHaveValue("2026-03-01");
    expect(within(bar).getByPlaceholderText(en("rpt.periodTo"))).toHaveValue("2026-03-31");
    const csv = screen.getByRole("button", { name: en("rpt.csvOf", { title: "Average by branch" }) });
    await waitFor(() => expect(csv).toBeEnabled(), WAIT);
    api.set(CSV, () => new Promise<Response>((resolve) => { finishNewCsv = resolve; }));
    await userEvent.click(csv);
    await waitFor(() => expect(finishNewCsv).toBeTypeOf("function"), WAIT);
    await act(async () => {
      finishOldCsv(new Response("category,value\nOld snapshot,100\n", { status: 200 }));
      finishOldData(json(200, RESULT()));
    });
    expect(created).not.toHaveBeenCalled();
    expect(csv).toBeDisabled();
    expect(screen.getByText("2026-03-01 – 2026-03-31")).toBeInTheDocument();
    await act(async () => { finishNewCsv(new Response("category,value\nNew snapshot,200\n", { status: 200 })); });
    await waitFor(() => expect(csv).toBeEnabled(), WAIT);
    expect(created).toHaveBeenCalledTimes(1);
  }, LONG);

  it("tracks concurrent CSV requests independently by card", async () => {
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:csv", revokeObjectURL: vi.fn() }));
    const finishes = new Map<string, (response: Response) => void>();
    const initial = RESULT();
    const twoCards = { ...CONFIG, cards: [CONFIG.cards[0], { ...CONFIG.cards[0], id: "c2", title: "Other branch", layout: { x: 6, y: 0, w: 6, h: 4 } }] };
    inOrg(VIEWER, {
      [ONE]: () => json(200, detail({ published: { ...detail().published!, config: twoCards } })),
      [DATA]: () => json(200, RESULT({ cards: [...initial.cards, { ...initial.cards[0], card_id: "c2" }] })),
      [CSV]: (r) => new Promise<Response>((resolve) => { finishes.set(new URL(r.url).searchParams.get("card_id")!, resolve); }),
    });
    renderAt("/reports/31");
    await screen.findAllByRole("rowheader", { name: "Bangkok" }, WAIT);
    const a = screen.getByRole("button", { name: en("rpt.csvOf", { title: "Sales by branch" }) });
    const b = screen.getByRole("button", { name: en("rpt.csvOf", { title: "Other branch" }) });
    await userEvent.click(a);
    await waitFor(() => expect(finishes.has("c1")).toBe(true), WAIT);
    await userEvent.click(b);
    await waitFor(() => expect(finishes.has("c2")).toBe(true), WAIT);
    expect(a).toBeDisabled();
    expect(b).toBeDisabled();
    await act(async () => { finishes.get("c1")!(new Response("category,value\nA,100\n", { status: 200 })); });
    await waitFor(() => expect(a).toBeEnabled(), WAIT);
    expect(b).toBeDisabled();
    await act(async () => { finishes.get("c2")!(new Response("category,value\nB,200\n", { status: 200 })); });
    await waitFor(() => expect(b).toBeEnabled(), WAIT);
  }, LONG);

  it("pins CSV to the displayed actual period even when the default year has changed", async () => {
    const displayed = { from: "2025-01-01", to: "2025-12-31" };
    const api = inOrg(VIEWER, {
      [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT({ period: displayed })),
      [CSV]: () => json(409, { code: "report_export_failed", message_key: "error.report_export_failed" }),
    });
    renderAt("/reports/31");
    await screen.findByRole("rowheader", { name: "Bangkok" }, WAIT);
    await userEvent.click(screen.getByRole("button", { name: en("rpt.csvOf", { title: "Sales by branch" }) }));
    await waitFor(() => expect(api.count(CSV)).toBe(1), WAIT);
    const url = new URL(api.calls.find((c) => c.url.includes("/csv"))!.url);
    expect(url.searchParams.get("from")).toBe(displayed.from);
    expect(url.searchParams.get("to")).toBe(displayed.to);
    expect((await api.bodies(DATA))[0]).toEqual({ period: null, refresh: false });
  }, LONG);

  it("pins CSV to the screen version and reloads after a publication conflict", async () => {
    const created = vi.fn(() => "blob:wrong-version");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }));
    let requestedVersion: string | null = null;
    const api = inOrg(VIEWER, {
      [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()),
      [CSV]: (r) => {
        requestedVersion = new URL(r.url).searchParams.get("report_version");
        return json(409, { code: "revision_conflict", message_key: "error.revision_conflict" });
      },
    });
    renderAt("/reports/31");
    await screen.findByRole("rowheader", { name: "Bangkok" }, WAIT);
    api.set(ONE, () => json(200, detail({ published: { ...detail().published!, name: "New published overview", version: 3 } })));
    api.set(DATA, () => json(200, RESULT({ report_version: 3 })));
    await userEvent.click(screen.getByRole("button", { name: en("rpt.csvOf", { title: "Sales by branch" }) }));
    await waitFor(() => expect(api.count(CSV)).toBe(1), WAIT);
    expect(requestedVersion).toBe("2");
    expect(await screen.findByRole("heading", { name: "New published overview" }, WAIT)).toBeInTheDocument();
    expect(created).not.toHaveBeenCalled();
  }, LONG);

  it.each([401, 403, 404, 409])("clears values when a CSV refusal reveals revoked report access (%s)", async (status) => {
    const api = inOrg(VIEWER, { [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()) });
    renderAt("/reports/31");
    await screen.findByRole("rowheader", { name: "Bangkok" }, WAIT);
    const code = status === 409 ? "report_not_published" : "permission_denied";
    const denial = () => json(status, { code, message_key: `error.${code}` });
    api.set(ONE, denial);
    api.set(DATA, denial);
    api.set(CSV, denial);
    await userEvent.click(screen.getByRole("button", { name: en("rpt.csvOf", { title: "Sales by branch" }) }));
    await waitFor(() => expect(screen.queryByRole("rowheader", { name: "Bangkok" })).toBeNull(), WAIT);
    expect(screen.queryByText(/4 documents · 1 excluded/)).toBeNull();
  }, LONG);

  it("rechecks export-only revocation using the currently selected period", async () => {
    let finishCsv!: (response: Response) => void;
    const api = inOrg(VIEWER, {
      [ONE]: () => json(200, detail()),
      [DATA]: async (r) => {
        const body = (await r.json()) as { period: { from: string; to: string } | null };
        return json(200, RESULT(body.period ? { period: body.period } : {}));
      },
      [CSV]: () => new Promise<Response>((resolve) => { finishCsv = resolve; }),
    });
    renderAt("/reports/31");
    await screen.findByRole("rowheader", { name: "Bangkok" }, WAIT);
    await userEvent.click(screen.getByRole("button", { name: en("rpt.csvOf", { title: "Sales by branch" }) }));
    await waitFor(() => expect(finishCsv).toBeTypeOf("function"), WAIT);
    const bar = screen.getByRole("region", { name: en("rpt.periodBar") });
    await userEvent.click(within(bar).getByPlaceholderText(en("rpt.periodFrom")));
    await userEvent.keyboard("2026-03-01{Enter}");
    await userEvent.keyboard("2026-03-31{Enter}");
    await userEvent.click(within(bar).getByRole("button", { name: en("rpt.applyPeriod") }));
    await screen.findByText("2026-03-01 – 2026-03-31", {}, WAIT);
    api.set(ONE, () => json(200, detail({ can_export: false })));
    await act(async () => { finishCsv(json(403, { code: "permission_denied", message_key: "error.permission_denied" })); });
    await waitFor(() => expect(api.count(DATA)).toBe(3), WAIT);
    expect((await api.bodies(DATA)).at(-1)).toEqual({ period: { from: "2026-03-01", to: "2026-03-31" }, refresh: true });
    expect(await screen.findByText("2026-03-01 – 2026-03-31", {}, WAIT)).toBeInTheDocument();
    expect(await screen.findByRole("rowheader", { name: "Bangkok" }, WAIT)).toBeInTheDocument();
  }, LONG);

  it("honours a pending CSV denial even after an overlapping refresh starts", async () => {
    let finishCsv!: (response: Response) => void;
    let finishRefresh!: (response: Response) => void;
    const api = inOrg(VIEWER, {
      [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()),
      [CSV]: () => new Promise<Response>((resolve) => { finishCsv = resolve; }),
    });
    renderAt("/reports/31");
    await screen.findByRole("rowheader", { name: "Bangkok" }, WAIT);
    await userEvent.click(screen.getByRole("button", { name: en("rpt.csvOf", { title: "Sales by branch" }) }));
    await waitFor(() => expect(finishCsv).toBeTypeOf("function"), WAIT);
    api.set(DATA, () => new Promise<Response>((resolve) => { finishRefresh = resolve; }));
    await userEvent.click(screen.getByRole("button", { name: en("rpt.refresh") }));
    await waitFor(() => expect(finishRefresh).toBeTypeOf("function"), WAIT);
    const denial = () => json(403, { code: "permission_denied", message_key: "error.permission_denied" });
    api.set(ONE, denial);
    api.set(DATA, denial);
    await act(async () => { finishCsv(denial()); });
    await waitFor(() => expect(screen.queryByRole("rowheader", { name: "Bangkok" })).toBeNull(), WAIT);
    expect(screen.queryByText(/4 documents · 1 excluded/)).toBeNull();
    await act(async () => { finishRefresh(json(200, RESULT())); });
    expect(screen.queryByRole("rowheader", { name: "Bangkok" })).toBeNull();
  }, LONG);

  it("does not deliver a pending CSV after refresh reports unpublication", async () => {
    const created = vi.fn(() => "blob:unpublished");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }));
    let finishCsv!: (response: Response) => void;
    const api = inOrg(VIEWER, {
      [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()),
      [CSV]: () => new Promise<Response>((resolve) => { finishCsv = resolve; }),
    });
    renderAt("/reports/31");
    await screen.findByRole("rowheader", { name: "Bangkok" }, WAIT);
    await userEvent.click(screen.getByRole("button", { name: en("rpt.csvOf", { title: "Sales by branch" }) }));
    await waitFor(() => expect(finishCsv).toBeTypeOf("function"), WAIT);
    api.set(DATA, () => json(409, { code: "report_not_published", message_key: "error.report_not_published" }));
    await userEvent.click(screen.getByRole("button", { name: en("rpt.refresh") }));
    expect(await screen.findByText(en("rpt.unpublishedNow"), {}, WAIT)).toBeInTheDocument();
    await act(async () => { finishCsv(new Response("category,value\nOld publication,100\n", { status: 200 })); });
    expect(created).not.toHaveBeenCalled();
    expect(screen.queryByRole("rowheader", { name: "Bangkok" })).toBeNull();
  }, LONG);

  it("does not deliver a late CSV after a tenant switch", async () => {
    const created = vi.fn(() => "blob:old-tenant");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }));
    let finish!: (response: Response) => void;
    inOrg(VIEWER, {
      [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()),
      [CSV]: () => new Promise<Response>((resolve) => { finish = resolve; }),
    });
    renderAt("/reports/31");
    await screen.findByRole("rowheader", { name: "Bangkok" }, WAIT);
    await userEvent.click(screen.getByRole("button", { name: en("rpt.csvOf", { title: "Sales by branch" }) }));
    await waitFor(() => expect(finish).toBeTypeOf("function"), WAIT);
    act(() => useTenantChoice.getState().choose(PERSONAL.tenant_id));
    await waitFor(() => expect(screen.queryByRole("rowheader", { name: "Bangkok" })).toBeNull(), WAIT);
    await act(async () => { finish(new Response("category,value\nOld tenant,100\n", { status: 200, headers: { "Content-Type": "text/csv" } })); });
    expect(created).not.toHaveBeenCalled();
  }, LONG);

  it("rechecks a CSV refusal without treating export-only revocation as lost viewing access", async () => {
    const api = inOrg(VIEWER, { [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()) });
    renderAt("/reports/31");
    await screen.findByRole("rowheader", { name: "Bangkok" }, WAIT);
    api.set(ONE, () => json(200, detail({ can_export: false })));
    api.set(CSV, () => json(403, { code: "permission_denied", message_key: "error.permission_denied" }));
    await userEvent.click(screen.getByRole("button", { name: en("rpt.csvOf", { title: "Sales by branch" }) }));
    await waitFor(() => expect(screen.queryByRole("button", { name: en("rpt.csvOf", { title: "Sales by branch" }) })).toBeNull(), WAIT);
    expect(await screen.findByRole("rowheader", { name: "Bangkok" }, WAIT)).toBeInTheDocument();
  }, LONG);

  it(
    "queries the whole page again for an overridden period, and back as published",
    async () => {
      const api = inOrg(VIEWER, { [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()) });
      renderAt("/reports/31");
      await screen.findByRole("rowheader", { name: "Bangkok" }, WAIT);
      const bar = screen.getByRole("region", { name: en("rpt.periodBar") });
      expect(within(bar).getByRole("button", { name: en("rpt.applyPeriod") })).toBeDisabled();
      await userEvent.click(within(bar).getByPlaceholderText(en("rpt.periodFrom")));
      await userEvent.keyboard("2026-03-01{Enter}");
      await userEvent.keyboard("2026-03-31{Enter}");
      await userEvent.click(within(bar).getByRole("button", { name: en("rpt.applyPeriod") }));
      await waitFor(() => expect(api.count(DATA)).toBe(2), WAIT);
      expect((await api.bodies(DATA))[1]).toEqual({ period: { from: "2026-03-01", to: "2026-03-31" }, refresh: false });
      await userEvent.click(within(bar).getByRole("button", { name: en("rpt.resetPeriod") }));
      await waitFor(() => expect(api.count(DATA)).toBe(3), WAIT);
      expect((await api.bodies(DATA))[2]).toEqual({ period: null, refresh: false });
    },
    LONG,
  );

  it(
    "says so when the report was unpublished meanwhile",
    async () => {
      inOrg(VIEWER, {
        [ONE]: () => json(200, detail()),
        [DATA]: () => json(409, { code: "report_not_published", message_key: "error.report_not_published" }),
      });
      renderAt("/reports/31");
      expect(await screen.findByText(en("rpt.unpublishedNow"), {}, WAIT)).toBeInTheDocument();
    },
    LONG,
  );

  it(
    "explains a report that is not published yet",
    async () => {
      inOrg(VIEWER, { [ONE]: () => json(200, detail({ published: null, status: "draft" })) });
      renderAt("/reports/31");
      expect(await screen.findByText(en("rpt.notPublishedYet"), {}, WAIT)).toBeInTheDocument();
    },
    LONG,
  );

  it(
    "downloads a card CSV with the card id, and explains a refused export",
    async () => {
      const createObjectURL = vi.fn(() => "blob:report");
      vi.stubGlobal("URL", Object.assign(URL, { createObjectURL, revokeObjectURL: vi.fn() }));
      const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
      const api = inOrg(VIEWER, {
        [ONE]: () => json(200, detail()),
        [DATA]: () => json(200, RESULT()),
        [CSV]: () => new Response("dimension,value\nBangkok,1500.50\n", { status: 200, headers: { "Content-Type": "text/csv" } }),
      });
      renderAt("/reports/31");
      await screen.findByRole("rowheader", { name: "Bangkok" }, WAIT);
      const csv = screen.getByRole("button", { name: en("rpt.csvOf", { title: "Sales by branch" }) });
      await userEvent.click(csv);
      await waitFor(() => expect(click).toHaveBeenCalledOnce(), WAIT);
      const url = new URL(api.calls.find((c) => c.url.includes("/csv"))!.url);
      expect(url.searchParams.get("card_id")).toBe("c1");
      expect(url.searchParams.get("report_version")).toBe("2");
      expect(url.searchParams.get("from")).toBe(RESULT().period.from);
      expect(url.searchParams.get("to")).toBe(RESULT().period.to);

      api.set(CSV, () =>
        json(409, { code: "report_export_failed", message_key: "error.report_export_failed", details: { error_code: "group_limit" } }),
      );
      await userEvent.click(csv);
      expect(await screen.findByText(new RegExp(en("rpt.exportFailed").replace(".", "\\.")), {}, WAIT)).toBeInTheDocument();
      expect(screen.getByText(new RegExp(en("rpc.err.group_limit").slice(0, 20)))).toBeInTheDocument();
      expect(click).toHaveBeenCalledOnce();
      click.mockRestore();
    },
    LONG,
  );

  it(
    "offers no CSV without the export permission",
    async () => {
      inOrg(VIEWER_NO_EXPORT, { [ONE]: () => json(200, detail({ can_export: false })), [DATA]: () => json(200, RESULT()) });
      renderAt("/reports/31");
      await screen.findByRole("rowheader", { name: "Bangkok" }, WAIT);
      expect(screen.queryByRole("button", { name: en("rpt.csvOf", { title: "Sales by branch" }) })).toBeNull();
      expect(screen.getByRole("button", { name: en("rpt.details") })).toBeInTheDocument();
    },
    LONG,
  );
});

describe("report designer page (FR-REPORT-014, FR-SYS-141)", () => {
  const draftDetail = (over: Partial<ReportDetail> = {}) =>
    detail({ can_manage: true, status: "changed", draft: CONFIG, revision: 4, ...over });
  const catalog = { "GET /api/v1/reports/catalog/templates": () => json(200, { items: [] }) };

  it(
    "saves the renamed draft with its revision",
    async () => {
      const api = inOrg(DESIGNER, {
        ...catalog,
        [ONE]: () => json(200, draftDetail()),
        "PUT /api/v1/reports/31": () => json(200, draftDetail({ name: "Sales 2026", revision: 5 })),
      });
      renderAt("/reports/31/design");
      const toolbar = await screen.findByRole("region", { name: en("rpt.toolbar") }, WAIT);
      expect(within(toolbar).getByRole("button", { name: en("rpt.saveDraft") })).toBeDisabled();
      expect(screen.getByText(en("rpt.changedNote", { n: 2 }))).toBeInTheDocument();
      const name = within(toolbar).getByRole("textbox");
      await userEvent.clear(name);
      expect(within(toolbar).getByText(en("rpt.nameRequired"))).toBeInTheDocument();
      expect(within(toolbar).getByRole("button", { name: en("rpt.publish") })).toBeDisabled();
      await userEvent.type(name, "Sales 2026");
      await userEvent.click(within(toolbar).getByRole("button", { name: en("rpt.saveDraft") }));
      const [sent] = (await api.bodies("PUT /api/v1/reports/31")) as { revision: number; name: string; config: unknown }[];
      expect(sent).toMatchObject({ revision: 4, name: "Sales 2026" });
      expect(sent!.config).toEqual(CONFIG);
      expect(await screen.findByText(en("rpt.saved"), {}, WAIT)).toBeInTheDocument();
    },
    LONG,
  );

  it(
    "shows a refused publication and publishes once fixed",
    async () => {
      const api = inOrg(DESIGNER, {
        ...catalog,
        [ONE]: () => json(200, draftDetail()),
        "POST /api/v1/reports/31/publish": () =>
          json(422, {
            code: "report_invalid",
            message_key: "error.report_invalid",
            details: { errors: [{ path: "cards[0].data.template_id", message: "need_template", card_id: "c1" }] },
          }),
      });
      renderAt("/reports/31/design");
      const toolbar = await screen.findByRole("region", { name: en("rpt.toolbar") }, WAIT);
      await userEvent.click(within(toolbar).getByRole("button", { name: en("rpt.publish") }));
      expect(await screen.findByText(en("rpt.publishRefused", { n: 1 }), {}, WAIT)).toBeInTheDocument();
      // nothing was edited, so the stored draft is judged as it is
      expect(api.count("PUT /api/v1/reports/31")).toBe(0);
      expect(await api.bodies("POST /api/v1/reports/31/publish")).toEqual([{ revision: 4 }]);

      api.set("POST /api/v1/reports/31/publish", () => json(200, draftDetail({ status: "published", revision: 5 })));
      // (antd keeps the fading loading icon in jsdom, so the name may start with "loading")
      await userEvent.click(within(toolbar).getByRole("button", { name: new RegExp(`${en("rpt.publish")}$`) }));
      expect(await screen.findByText(en("rpt.published"), {}, WAIT)).toBeInTheDocument();
      expect(screen.queryByText(en("rpt.publishRefused", { n: 1 }))).toBeNull();
    },
    LONG,
  );

  it(
    "saves local edits before publishing, on the saved revision",
    async () => {
      const api = inOrg(DESIGNER, {
        ...catalog,
        [ONE]: () => json(200, draftDetail()),
        "PUT /api/v1/reports/31": () => json(200, draftDetail({ name: "Renamed", revision: 5 })),
        "POST /api/v1/reports/31/publish": () => json(200, draftDetail({ name: "Renamed", status: "published", revision: 6 })),
      });
      renderAt("/reports/31/design");
      const toolbar = await screen.findByRole("region", { name: en("rpt.toolbar") }, WAIT);
      const name = within(toolbar).getByRole("textbox");
      await userEvent.clear(name);
      await userEvent.type(name, "Renamed");
      await userEvent.click(within(toolbar).getByRole("button", { name: en("rpt.publish") }));
      expect(await screen.findByText(en("rpt.published"), {}, WAIT)).toBeInTheDocument();
      expect(await api.bodies("POST /api/v1/reports/31/publish")).toEqual([{ revision: 5 }]);
    },
    LONG,
  );

  it(
    "offers a reload on a revision conflict",
    async () => {
      inOrg(DESIGNER, {
        ...catalog,
        [ONE]: () => json(200, draftDetail()),
        "PUT /api/v1/reports/31": () => json(409, { code: "revision_conflict", message_key: "error.revision_conflict" }),
      });
      renderAt("/reports/31/design");
      const toolbar = await screen.findByRole("region", { name: en("rpt.toolbar") }, WAIT);
      await userEvent.type(within(toolbar).getByRole("textbox"), "!");
      await userEvent.click(within(toolbar).getByRole("button", { name: en("rpt.saveDraft") }));
      expect(await screen.findByText(en("rpt.conflict"), {}, WAIT)).toBeInTheDocument();
      expect(screen.getByRole("button", { name: en("rpt.reload") })).toBeInTheDocument();
    },
    LONG,
  );
});
