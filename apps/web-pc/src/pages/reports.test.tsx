import * as reportUi from "@saiflow/ui";
import { screen, waitFor, within } from "@testing-library/react";
import { act, Children, isValidElement, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { formatBangkokDateTime } from "../format";
import { translate } from "../i18n";
import type { ReportDetail, ReportSummary } from "../reports/api";
import { useLanguage } from "../stores/language";
import { dashboard, en, renderAt, signedIn, userEvent } from "../test/app";
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

describe("report homepage (FR-SYS-171)", () => {
  it("default dashboard retries a failed PG read without fabricated numbers", async () => {
    const api = inOrg(VIEWER, { "GET /api/v1/me/dashboard": () => json(503, { code: "data_source_unavailable" }) });
    renderAt("/");
    const retry = await screen.findByRole("button", { name: en("common.retry") }, WAIT);
    expect(screen.queryByTestId("usage-card")).not.toBeInTheDocument();
    expect(screen.queryByTestId("metric-strip")).not.toBeInTheDocument();
    api.set("GET /api/v1/me/dashboard", () => json(200, dashboard("organization")));
    await userEvent.click(retry);
    expect(await screen.findByRole("meter", {}, WAIT)).toHaveAttribute("aria-valuenow", "0");
  }, LONG);

  it.each(["personal", "organization"] as const)("uses the %s built-in dashboard configuration without a marketing flow", async (kind) => {
    inOrg(VIEWER);
    localStorage.setItem("saiflow.pc.tenant.7", kind === "personal" ? "70" : "5");
    renderAt("/");
    const page = await screen.findByTestId("page-home", {}, WAIT);
    await within(page).findByRole("region", { name: en(kind === "personal" ? "rpt.personalHome" : "rpt.organizationHome") }, WAIT);
    expect(page.querySelector(".pc-home")).toHaveAttribute("data-home-default", kind);
    expect(page.querySelector(".pc-flow")).not.toBeInTheDocument();
    expect(page.querySelector(".pc-page__heading")).not.toBeInTheDocument();
  }, LONG);

  it("does not restore a late homepage preference from the previous tenant", async () => {
    let finish!: (response: Response) => void;
    const api = inOrg(VIEWER, {
      "GET /api/v1/me/homepage": (request) => request.headers.get("X-Tenant-Id") === "5"
        ? new Promise<Response>((resolve) => { finish = resolve; })
        : json(200, { report_id: null, default: "personal" }),
      [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()),
    });
    renderAt("/");
    await waitFor(() => expect(finish).toBeTypeOf("function"), WAIT);
    act(() => useTenantChoice.getState().choose(PERSONAL.tenant_id));
    await screen.findByRole("region", { name: en("rpt.personalHome") }, WAIT);
    await act(async () => { finish(json(200, { report_id: 31, default: "organization" })); });
    expect(screen.queryByText("Sales overview")).not.toBeInTheDocument();
    expect(api.count(DATA)).toBe(0);
  }, LONG);

  it("does not restore a late dashboard response after switching tenants", async () => {
    let finish!: (response: Response) => void;
    inOrg(VIEWER, { "GET /api/v1/me/dashboard": (r) => r.headers.get("X-Tenant-Id") === "5"
      ? new Promise<Response>((resolve) => { finish = resolve; }) : json(200, dashboard("personal")) });
    renderAt("/");
    await waitFor(() => expect(finish).toBeTypeOf("function"), WAIT);
    act(() => useTenantChoice.getState().choose(PERSONAL.tenant_id));
    await screen.findByRole("region", { name: en("rpt.personalHome") }, WAIT);
    await act(async () => finish(json(200, { ...dashboard("organization"), counts: { VERIFYING: 999999 } })));
    expect(screen.queryByText("999,999")).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: en("rpt.organizationHome") })).not.toBeInTheDocument();
  }, LONG);

  it("retries a custom homepage plan read without discarding its choice", async () => {
    const api = inOrg(VIEWER, {
      "GET /api/v1/me/homepage": () => json(200, { report_id: 31, default: "organization" }),
      [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()),
    }, null);
    api.set(USAGE_ROUTE, () => json(500, { code: "internal_error" }));
    renderAt("/");
    await screen.findByRole("alert", {}, WAIT);
    api.set(USAGE_ROUTE, () => json(200, USAGE));
    await userEvent.click(screen.getByRole("button", { name: en("common.retry") }));
    expect(await screen.findByText("Bangkok", {}, WAIT)).toBeInTheDocument();
    expect(api.count("PUT /api/v1/me/homepage")).toBe(0);
  }, LONG);

  it("data permission revocation falls back without erasing the saved report", async () => {
    const api = inOrg(VIEWER, {
      "GET /api/v1/me/homepage": () => json(200, { report_id: 31, default: "organization" }),
      [ONE]: () => json(200, detail()), [DATA]: () => json(403, { code: "forbidden" }),
    });
    renderAt("/");
    expect(await screen.findByRole("region", { name: en("rpt.organizationHome") }, WAIT)).toBeInTheDocument();
    expect(api.count("PUT /api/v1/me/homepage")).toBe(0);
  }, LONG);

  it("opens the selected published report at root with Home still selected", async () => {
    inOrg(VIEWER, {
      "GET /api/v1/me/homepage": () => json(200, { report_id: 31, default: "organization" }),
      [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()),
    });
    renderAt("/");
    expect(await screen.findByText("Bangkok", {}, WAIT)).toBeInTheDocument();
    expect(screen.getByTestId("page-home")).not.toHaveTextContent("Sales overview");
    expect(screen.queryByRole("region", { name: en("rpt.periodBar") })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: en("rpt.refresh") })).not.toBeInTheDocument();
    const home = within(screen.getByRole("menu")).getByRole("link", { name: en("nav.home") });
    expect(home.closest("li")).toHaveClass("ant-menu-item-selected");
    expect(screen.queryByRole("button", { name: en("rpt.resetHome") })).not.toBeInTheDocument();
  }, LONG);

  it("an ordinary preference read failure offers retry, not a default dashboard", async () => {
    const api = inOrg(VIEWER, { "GET /api/v1/me/homepage": () => json(500, { code: "internal_error" }) });
    renderAt("/");
    expect(await screen.findByRole("alert", {}, WAIT)).toHaveTextContent(en("rpt.loadFailed"));
    expect(screen.queryByTestId("usage-card")).not.toBeInTheDocument();
    api.set("GET /api/v1/me/homepage", () => json(200, { report_id: null, default: "organization" }));
    await userEvent.click(screen.getByRole("button", { name: en("common.retry") }));
    expect(await screen.findByRole("region", { name: en("rpt.organizationHome") }, WAIT)).toBeInTheDocument();
    expect(await screen.findByTestId("usage-card", {}, WAIT)).toBeInTheDocument();
  }, LONG);

  it("a selected report that disappears falls back without erasing the preference", async () => {
    const api = inOrg(VIEWER, {
      "GET /api/v1/me/homepage": () => json(200, { report_id: 31, default: "organization" }),
      [ONE]: () => json(404, { code: "not_found" }),
    });
    renderAt("/");
    expect(await screen.findByRole("region", { name: en("rpt.organizationHome") }, WAIT)).toBeInTheDocument();
    expect(api.count("PUT /api/v1/me/homepage")).toBe(0);
  }, LONG);

  it("sets and resets a readable homepage from its normal report viewer", async () => {
    let choice: number | null = null;
    const api = inOrg(VIEWER, {
      "GET /api/v1/me/homepage": () => json(200, { report_id: choice, default: "organization" }),
      "PUT /api/v1/me/homepage": async (r) => {
        choice = (await r.json()).report_id;
        return json(200, { report_id: choice, default: "organization" });
      },
      [LIST]: () => json(200, { items: [summary()] }), [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()),
    });
    renderAt("/report-view/31");
    await screen.findByText("Bangkok", {}, WAIT);
    await userEvent.click(screen.getByRole("button", { name: en("rpt.setHome") }));
    await waitFor(async () => expect(await api.bodies("PUT /api/v1/me/homepage")).toEqual([{ report_id: 31 }]));
    await userEvent.click(within(screen.getByRole("menu")).getByRole("link", { name: en("nav.home") }));
    await screen.findByTestId("page-home", {}, WAIT);
    await userEvent.click(within(screen.getByRole("menu")).getByRole("link", { name: en("nav.reportView") }));
    await userEvent.click(await screen.findByRole("link", { name: /Sales overview/ }, WAIT));
    await userEvent.click(await screen.findByRole("button", { name: en("rpt.resetHome") }, WAIT));
    await userEvent.click(within(screen.getByRole("menu")).getByRole("link", { name: en("nav.home") }));
    expect(await screen.findByRole("region", { name: en("rpt.organizationHome") }, WAIT)).toBeInTheDocument();
    expect(await api.bodies("PUT /api/v1/me/homepage")).toEqual([{ report_id: 31 }, { report_id: null }]);
  }, LONG);
});

describe("report menu and gate (FR-SYS-141)", () => {
  it(
    "sends a report_view holder without report_manage from /reports to the view menu (AC-FR-SYS-159-02)",
    async () => {
      inOrg(VIEWER, { [LIST]: () => json(200, { items: [summary()] }) });
      renderAt("/reports");
      const card = (await screen.findByText("Sales overview", {}, WAIT)).closest("a") as HTMLElement;
      expect(card).toHaveAttribute("href", "/report-view/31");
      const links = await menuLinks();
      expect(links).toContain(en("nav.reportView"));
      expect(links).not.toContain(en("nav.reports"));
      expect(screen.queryByRole("button", { name: en("rpt.new") })).toBeNull();
    },
    LONG,
  );

  it(
    "shows the management list with status and actions to a designer",
    async () => {
      inOrg(DESIGNER, { [LIST]: () => json(200, { items: [summary({ can_manage: true })] }) });
      renderAt("/reports");
      const row = (await screen.findByText("Sales overview", {}, WAIT)).closest("tr") as HTMLElement;
      expect(await menuLinks()).toContain(en("nav.reports"));
      expect(within(row).getByText(en("rpt.status.published"))).toBeInTheDocument();
      expect(within(row).getByText(/v2/)).toBeInTheDocument();
      expect(within(row).getByRole("button", { name: en("rpt.open") })).toBeInTheDocument();
      expect(within(row).getByRole("button", { name: en("rpt.design") })).toBeInTheDocument();
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

describe("view reports menu (FR-SYS-159, FR-SYS-160)", () => {
  const selectedItem = () => document.querySelector(".ant-menu-item-selected")?.textContent;

  it(
    "shows a viewer only the view menu, and a designer both (AC-FR-SYS-159-01)",
    async () => {
      inOrg(VIEWER, { [LIST]: () => json(200, { items: [summary()] }) });
      renderAt("/report-view");
      await screen.findByText("Sales overview", {}, WAIT);
      const links = await menuLinks();
      expect(links).toContain(en("nav.reportView"));
      expect(links).not.toContain(en("nav.reports"));
      // in the workspace group, right after Reviews' position (Reviews is hidden for this viewer)
      expect(links.indexOf(en("nav.reportView"))).toBe(links.indexOf(en("nav.library")) + 1);
    },
    LONG,
  );

  it(
    "gives a designer both menus",
    async () => {
      inOrg(DESIGNER, { [LIST]: () => json(200, { items: [summary({ can_manage: true })] }) });
      renderAt("/report-view");
      await screen.findByText("Sales overview", {}, WAIT);
      const links = await menuLinks();
      expect(links).toContain(en("nav.reportView"));
      expect(links).toContain(en("nav.reports"));
    },
    LONG,
  );

  it(
    "lists only published reports as cards, without create or design (AC-FR-SYS-160-01)",
    async () => {
      inOrg(DESIGNER, {
        [LIST]: () =>
          json(200, {
            items: [
              summary({ can_manage: true }),
              summary({ id: 32, name: "Draft only", status: "draft", published_version: null, published_at: null, can_manage: true }),
            ],
          }),
      });
      renderAt("/report-view");
      const list = await screen.findByRole("list", { name: en("nav.reportView") }, WAIT);
      expect(within(list).getAllByRole("link")).toHaveLength(1);
      const card = within(list).getByRole("link");
      expect(card).toHaveAttribute("href", "/report-view/31");
      expect(within(card).getByText("Sales overview")).toBeInTheDocument();
      expect(within(card).getByText(en("rpt.version", { n: 2 }))).toBeInTheDocument();
      expect(screen.queryByText("Draft only")).toBeNull();
      expect(screen.getByText(en("rpt.viewCount", { n: 1 }))).toBeInTheDocument();
      expect(screen.queryByRole("button", { name: en("rpt.new") })).toBeNull();
      expect(screen.queryByRole("button", { name: en("rpt.design") })).toBeNull();
      expect(selectedItem()).toBe(en("nav.reportView"));
    },
    LONG,
  );

  it(
    "opens a card read-only under the view menu and comes back to the list (AC-FR-SYS-160-01)",
    async () => {
      inOrg(VIEWER, {
        [LIST]: () => json(200, { items: [summary()] }),
        [ONE]: () => json(200, detail()),
        [DATA]: () => json(200, RESULT()),
      });
      renderAt("/report-view");
      await userEvent.click(await screen.findByRole("link", { name: /Sales overview/ }, WAIT));
      expect(await screen.findByRole("rowheader", { name: "Bangkok" }, WAIT)).toBeInTheDocument();
      expect(selectedItem()).toBe(en("nav.reportView"));
      expect(screen.queryByRole("button", { name: en("rpt.design") })).toBeNull();
      await userEvent.click(screen.getByRole("button", { name: new RegExp(`${en("rpt.backToList")}$`) }));
      expect(await screen.findByRole("list", { name: en("nav.reportView") }, WAIT)).toBeInTheDocument();
      expect(selectedItem()).toBe(en("nav.reportView"));
    },
    LONG,
  );

  it(
    "shows an empty state when nothing is published (AC-FR-SYS-160-02)",
    async () => {
      inOrg(VIEWER, { [LIST]: () => json(200, { items: [summary({ published_version: null, published_at: null, status: "draft" })] }) });
      renderAt("/report-view");
      expect(await screen.findByText(en("rpt.emptyView"), {}, WAIT)).toBeInTheDocument();
      expect(screen.queryByRole("list", { name: en("nav.reportView") })).toBeNull();
    },
    LONG,
  );

  it(
    "hides and refuses the view menu without report_view (AC-FR-SYS-159-03)",
    async () => {
      const api = inOrg({ ...ORG, permissions: ["report_manage"] }, { [LIST]: () => json(200, { items: [] }) });
      renderAt("/report-view");
      expect(await screen.findByText(en("rpt.noView"), {}, WAIT)).toBeInTheDocument();
      expect(await menuLinks()).not.toContain(en("nav.reportView"));
      expect(api.count(LIST)).toBe(0);
    },
    LONG,
  );

  it(
    "hides and refuses it below Starter (AC-FR-SYS-159-03)",
    async () => {
      const api = inOrg(VIEWER, { [LIST]: () => json(200, { items: [] }) }, KINDER);
      renderAt("/report-view");
      expect(await screen.findByText(en("rpt.unavailableBody"), {}, WAIT)).toBeInTheDocument();
      expect(await menuLinks()).not.toContain(en("nav.reportView"));
      expect(api.count(LIST)).toBe(0);
    },
    LONG,
  );

  it(
    "hides and refuses it for the personal account (AC-FR-SYS-159-03)",
    async () => {
      localStorage.clear();
      useTenantChoice.getState().reset();
      const api = signedIn({ [LIST]: () => json(200, { items: [] }) });
      renderAt("/report-view");
      expect(await screen.findByText(en("rpt.unavailable"), {}, WAIT)).toBeInTheDocument();
      expect(await menuLinks()).not.toContain(en("nav.reportView"));
      expect(api.count(LIST)).toBe(0);
    },
    LONG,
  );
});

describe("PC report presentation (FR-SYS-161, -163, -164)", () => {
  it("keeps first list loading, failure and empty mutually exclusive, with retry (164-01)", async () => {
    let finish!: (response: Response) => void;
    const api = inOrg(VIEWER, { [LIST]: () => new Promise<Response>((resolve) => { finish = resolve; }) });
    renderAt("/report-view");
    await waitFor(() => expect(finish).toBeTypeOf("function"), WAIT);
    const page = screen.getByTestId("page-report-view");
    expect(within(page).getByRole("status")).toHaveTextContent(en("rpc.loading"));
    expect(screen.queryByText(en("rpt.emptyView"))).toBeNull();
    await act(async () => { finish(json(503, { code: "unavailable", message_key: "error.unavailable" })); });
    const alert = await screen.findByRole("alert", {}, WAIT);
    expect(alert).toHaveTextContent("The published reports could not be loaded");
    expect(screen.queryByText(en("rpt.emptyView"))).toBeNull();
    expect(within(page).queryByRole("status")).toBeNull();
    api.set(LIST, () => json(200, { items: [] }));
    await userEvent.click(within(alert).getByRole("button", { name: en("common.retry") }));
    expect(await screen.findByText(en("rpt.emptyView"), {}, WAIT)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(api.count(LIST)).toBe(2);
  }, LONG);

  it("hides cached published links after a refused list refetch (164-03)", async () => {
    const api = inOrg(VIEWER, { [LIST]: () => json(200, { items: [summary()] }) });
    const { queryClient } = renderAt("/report-view");
    await screen.findByRole("link", { name: /Sales overview/ }, WAIT);
    api.set(LIST, () => json(403, { code: "permission_denied", message_key: "error.permission_denied" }));
    await act(async () => { await queryClient.refetchQueries({ queryKey: ["reports", 5], exact: true }); });
    await screen.findByRole("alert", {}, WAIT); // React Query notifies observers after the refetch promise settles.
    expect(screen.queryByRole("link", { name: /Sales overview/ })).toBeNull();
    expect(screen.queryByText(en("rpt.viewCount", { n: 1 }))).toBeNull();
    expect(screen.queryByText(en("rpt.emptyView"))).toBeNull();
  }, LONG);

  it.each(["en", "th", "zh"] as const)("keeps long Thai names and Bangkok publication readable and opens the entire card by keyboard in %s (161-01/02)", async (lang) => {
    const name = "รายงานยอดขายและการจัดส่งสำหรับทุกสาขาขององค์กรในประเทศไทย".repeat(2);
    useLanguage.getState().setLang(lang);
    inOrg(VIEWER, {
      [LIST]: () => json(200, { items: [summary({ name, published_at: "2026-11-10T20:30:00Z" })] }),
      [ONE]: () => json(200, detail({ published: { ...detail().published!, name } })),
      [DATA]: () => json(200, RESULT()),
    });
    renderAt("/report-view");
    const card = await screen.findByRole("link", { name: new RegExp(name) }, WAIT);
    expect(within(card).getByText(name)).toHaveAttribute("title", name);
    expect(within(card).getByText(translate(lang, "rpt.viewCardHint"))).toBeInTheDocument();
    expect(within(card).getByText(translate(lang, "rpt.version", { n: 2 }))).toBeInTheDocument();
    const time = card.querySelector("time");
    expect(time).toHaveAttribute("datetime", "2026-11-10T20:30:00Z");
    expect(time).toHaveTextContent("2026-11-11 03:30");
    expect(time).toHaveTextContent(translate(lang, "rpt.publishedAt", { at: "2026-11-11 03:30" }));
    for (let n = 0; n < 30 && document.activeElement !== card; n += 1) await userEvent.tab();
    expect(card).toHaveFocus();
    await userEvent.keyboard("{Enter}");
    expect(await screen.findByRole("heading", { name }, WAIT)).toBeInTheDocument();
    expect(await screen.findByRole("rowheader", { name: "Bangkok" }, WAIT)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: new RegExp(`${translate(lang, "rpt.backToList")}$`) }));
    expect(await screen.findByRole("list", { name: translate(lang, "nav.reportView") }, WAIT)).toBeInTheDocument();
  }, LONG);

  it.each([true, false])("never offers design to an owner on /report-view (published=%s), but management keeps it (163-02)", async (published) => {
    const api = inOrg({ ...ORG, is_owner: true }, {
      [ONE]: () => json(200, detail({ can_manage: true, ...(published ? {} : { published: null, status: "draft" }) })),
      [DATA]: () => json(200, RESULT()),
    });
    const view = renderAt("/report-view/31");
    if (published) await screen.findByRole("rowheader", { name: "Bangkok" }, WAIT);
    else await screen.findByText(en("rpt.notPublishedYet"), {}, WAIT);
    for (const key of ["rpt.design", "rpt.new", "rpt.publish", "rpt.unpublish", "rpt.delete"] as const) {
      expect(screen.queryByRole("button", { name: en(key) })).toBeNull();
    }
    if (!published) expect(api.count(DATA)).toBe(0);
    view.unmount();
    renderAt("/reports/31");
    expect(await screen.findByRole("button", { name: en("rpt.design") }, WAIT)).toBeInTheDocument();
  }, LONG);

  it("makes detail loading visible and retries a metadata error before requesting statistics (164-01)", async () => {
    let finish!: (response: Response) => void;
    const api = inOrg(VIEWER, { [ONE]: () => new Promise<Response>((resolve) => { finish = resolve; }), [DATA]: () => json(200, RESULT()) });
    renderAt("/report-view/31");
    await waitFor(() => expect(finish).toBeTypeOf("function"), WAIT);
    expect(screen.getByRole("status")).toHaveTextContent(en("rpc.loading"));
    expect(api.count(DATA)).toBe(0);
    await act(async () => { finish(json(503, { code: "unavailable", message_key: "error.unavailable" })); });
    const alert = await screen.findByRole("alert", {}, WAIT);
    expect(screen.queryByRole("rowheader", { name: "Bangkok" })).toBeNull();
    api.set(ONE, () => json(200, detail()));
    await userEvent.click(within(alert).getByRole("button", { name: en("common.retry") }));
    expect(await screen.findByRole("rowheader", { name: "Bangkok" }, WAIT)).toBeInTheDocument();
    expect(api.count(ONE)).toBe(2);
    expect(api.count(DATA)).toBe(1);
  }, LONG);

  it("provides a visible fallback while the published grid code loads (163-01)", async () => {
    const grid = vi.spyOn(reportUi, "ReportGrid").mockImplementation(({ fallback }) => <>{fallback}</>);
    try {
      inOrg(VIEWER, { [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()) });
      renderAt("/report-view/31");
      const loading = await screen.findByRole("status", { name: en("rpg.grid") }, WAIT);
      expect(loading).toHaveTextContent(en("rpc.loading"));
      expect(loading).not.toHaveClass("sf-visually-hidden");
    } finally {
      grid.mockRestore();
    }
  }, LONG);

  it("does not duplicate first statistics requests or confuse data failure with no charts (164-01/02)", async () => {
    let finish!: (response: Response) => void;
    const api = inOrg(VIEWER, {
      [ONE]: () => json(200, detail({ published: { ...detail().published!, config: { ...CONFIG, cards: [] } } })),
      [DATA]: () => new Promise<Response>((resolve) => { finish = resolve; }),
    });
    renderAt("/report-view/31");
    await waitFor(() => expect(finish).toBeTypeOf("function"), WAIT);
    const refresh = screen.getByRole("button", { name: en("rpt.refresh") });
    expect(refresh).toBeDisabled();
    await userEvent.click(refresh);
    expect(api.count(DATA)).toBe(1);
    expect(screen.queryByText(en("rpt.noCards"))).toBeNull();
    await act(async () => { finish(json(503, { code: "unavailable", message_key: "error.unavailable" })); });
    await screen.findByText(en("rpt.loadFailed"), {}, WAIT);
    expect(screen.queryByText(en("rpt.noCards"))).toBeNull();
    api.set(DATA, () => json(200, RESULT({ cards: [] })));
    await userEvent.click(screen.getByRole("button", { name: en("common.retry") }));
    expect(await screen.findByText(en("rpt.noCards"), {}, WAIT)).toBeInTheDocument();
  }, LONG);

  it("keeps the actual query time and readable stale notice after one in-flight refresh fails (164-02)", async () => {
    let finish!: (response: Response) => void;
    const api = inOrg(VIEWER, { [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()) });
    renderAt("/report-view/31");
    await screen.findByRole("rowheader", { name: "Bangkok" }, WAIT);
    const bar = screen.getByRole("region", { name: en("rpt.periodBar") });
    const at = formatBangkokDateTime(RESULT().generated_at);
    expect(within(bar).getByText(at)).toBeInTheDocument();
    api.set(DATA, () => new Promise<Response>((resolve) => { finish = resolve; }));
    const refresh = screen.getByRole("button", { name: en("rpt.refresh") });
    await userEvent.click(refresh);
    await waitFor(() => expect(finish).toBeTypeOf("function"), WAIT);
    expect(refresh).toBeDisabled();
    await userEvent.click(refresh);
    expect(api.count(DATA)).toBe(2);
    expect(screen.getByRole("button", { name: en("rpt.csvOf", { title: "Sales by branch" }) })).toBeDisabled();
    await act(async () => { finish(json(503, { code: "unavailable", message_key: "error.unavailable" })); });
    const alert = await screen.findByRole("alert", {}, WAIT);
    expect(alert).toHaveTextContent(en("rpt.staleBody", { at }));
    expect(within(bar).getByText(at)).toBeInTheDocument();
    expect(screen.getByRole("rowheader", { name: "Bangkok" })).toBeInTheDocument();
  }, LONG);

  it("applies one period to dated cards, explains the undated card and pins CSV before resetting (163-03)", async () => {
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:period", revokeObjectURL: vi.fn() }));
    const click = vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    try {
      const cards = [
        CONFIG.cards[0],
        { ...CONFIG.cards[0], id: "c2", title: "Other dated chart", layout: { x: 6, y: 0, w: 6, h: 4 } },
        { ...CONFIG.cards[0], id: "c3", title: "Undated chart", layout: { x: 0, y: 4, w: 12, h: 4 }, data: { ...CONFIG.cards[0]!.data, date_field: undefined } },
      ];
      const api = inOrg(VIEWER, {
        [ONE]: () => json(200, detail({ published: { ...detail().published!, config: { ...CONFIG, cards } } })),
        [DATA]: async (r) => {
          const body = await r.json() as { period: { from: string; to: string } | null };
          return json(200, RESULT({
            scope: "all",
            ...(body.period ? { period: body.period } : {}),
            cards: cards.map((c, i) => ({ ...RESULT().cards[0], card_id: c!.id, status: i === 2 ? "not_applicable" : "ok", period_applied: i !== 2 })),
          }));
        },
        [CSV]: () => new Response("category,value\nBangkok,1500.50\n", { status: 200 }),
      });
      renderAt("/report-view/31");
      await screen.findAllByRole("rowheader", { name: "Bangkok" }, WAIT);
      const bar = screen.getByRole("region", { name: en("rpt.periodBar") });
      expect(within(bar).getByText(en("rpt.scope.all"))).toBeInTheDocument();
      await userEvent.click(within(bar).getByPlaceholderText(en("rpt.periodFrom")));
      await userEvent.keyboard("2026-03-01{Enter}");
      await userEvent.keyboard("2026-03-31{Enter}");
      await userEvent.click(within(bar).getByRole("button", { name: en("rpt.applyPeriod") }));
      await screen.findByText("2026-03-01 – 2026-03-31", {}, WAIT);
      expect(screen.getByText(en("rpc.notApplicable"))).toBeInTheDocument();
      const tables = screen.getAllByRole("region", { name: /Sales by branch|Other dated chart|Undated chart/ });
      expect(tables).toHaveLength(3);
      for (const table of tables) expect(table).toHaveAttribute("tabindex", "0");
      await userEvent.click(screen.getByRole("button", { name: en("rpt.csvOf", { title: "Sales by branch" }) }));
      await waitFor(() => expect(click).toHaveBeenCalledOnce(), WAIT);
      const url = new URL(api.calls.find((c) => c.url.includes("/csv"))!.url);
      expect(url.searchParams.get("from")).toBe("2026-03-01");
      expect(url.searchParams.get("to")).toBe("2026-03-31");
      expect(url.searchParams.get("report_version")).toBe("2");
      expect((await api.bodies(DATA)).at(-1)).toEqual({ period: { from: "2026-03-01", to: "2026-03-31" }, refresh: false });
      await userEvent.click(within(bar).getByRole("button", { name: en("rpt.resetPeriod") }));
      await screen.findByText(/2026-01-01 – 2026-12-31/, {}, WAIT);
      expect((await api.bodies(DATA)).at(-1)).toEqual({ period: null, refresh: false });
    } finally {
      click.mockRestore();
    }
  }, LONG);

  it.each([
    ["manage only", { ...ORG, permissions: ["report_manage"] }, USAGE, "rpt.noView"],
    ["expired plan", VIEWER, { ...USAGE, active: false }, "rpt.unavailable"],
    ["Kinder", VIEWER, KINDER, "rpt.unavailable"],
  ] as const)("does not request statistics on direct view access with %s (161-03)", async (_name, tenant, usage, key) => {
    const api = inOrg(tenant as UsableTenant, { [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()) }, usage);
    renderAt("/report-view/31");
    await screen.findByText(en(key), {}, WAIT);
    expect(api.count(ONE)).toBe(0);
    expect(api.count(DATA)).toBe(0);
    expect(await menuLinks()).not.toContain(en("nav.reportView"));
  }, LONG);

  it("clears statistics and ignores a late answer after switching tenants (164-03)", async () => {
    let finish!: (response: Response) => void;
    const api = inOrg(VIEWER, { [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()) });
    renderAt("/report-view/31");
    await screen.findByRole("rowheader", { name: "Bangkok" }, WAIT);
    api.set(DATA, () => new Promise<Response>((resolve) => { finish = resolve; }));
    await userEvent.click(screen.getByRole("button", { name: en("rpt.refresh") }));
    await waitFor(() => expect(finish).toBeTypeOf("function"), WAIT);
    act(() => useTenantChoice.getState().choose(PERSONAL.tenant_id));
    await screen.findByText(en("rpt.unavailable"), {}, WAIT);
    await act(async () => { finish(json(200, RESULT())); });
    expect(screen.queryByRole("rowheader", { name: "Bangkok" })).toBeNull();
    expect(screen.queryByText(/4 documents · 1 excluded/)).toBeNull();
  }, LONG);

  it("rechecks publication and clears the old charts on a data version conflict (164-03)", async () => {
    let finish!: (response: Response) => void;
    const api = inOrg(VIEWER, { [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()) });
    renderAt("/report-view/31");
    await screen.findByRole("rowheader", { name: "Bangkok" }, WAIT);
    api.set(ONE, () => new Promise<Response>((resolve) => { finish = resolve; }));
    api.set(DATA, () => json(409, { code: "revision_conflict", message_key: "error.revision_conflict" }));
    await userEvent.click(screen.getByRole("button", { name: en("rpt.refresh") }));
    await waitFor(() => expect(finish).toBeTypeOf("function"), WAIT);
    expect(screen.queryByRole("rowheader", { name: "Bangkok" })).toBeNull();
    expect(screen.queryByText(en("rpt.staleTitle"))).toBeNull();
    api.set(DATA, () => json(200, RESULT({ report_version: 3 })));
    await act(async () => { finish(json(200, detail({ published: { ...detail().published!, version: 3 } }))); });
    expect(await screen.findByRole("rowheader", { name: "Bangkok" }, WAIT)).toBeInTheDocument();
    expect(screen.getByText(en("rpt.version", { n: 3 }))).toBeInTheDocument();
  }, LONG);

  it.each([
    [402, "plan_required"],
    [403, "permission_denied"],
    [409, "report_not_published"],
    [409, "revision_conflict"],
  ] as const)("honours an older refresh refusal %s/%s over a pending date request and CSV (164-03)", async (status, code) => {
    const created = vi.fn(() => "blob:refused-refresh");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }));
    let finishCsv!: (response: Response) => void;
    let csvSignal!: AbortSignal;
    const api = inOrg(VIEWER, {
      [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()),
      [CSV]: (r) => new Promise<Response>((resolve) => { finishCsv = resolve; csvSignal = r.signal; }),
    });
    renderAt("/report-view/31");
    await screen.findByRole("rowheader", { name: "Bangkok" }, WAIT);
    await userEvent.click(screen.getByRole("button", { name: en("rpt.csvOf", { title: "Sales by branch" }) }));
    await waitFor(() => expect(finishCsv).toBeTypeOf("function"), WAIT);
    const finishes: ((response: Response) => void)[] = [];
    api.set(DATA, () => new Promise<Response>((resolve) => { finishes.push(resolve); }));
    await userEvent.click(screen.getByRole("button", { name: en("rpt.refresh") }));
    await waitFor(() => expect(finishes).toHaveLength(1), WAIT);
    const bar = screen.getByRole("region", { name: en("rpt.periodBar") });
    await userEvent.click(within(bar).getByPlaceholderText(en("rpt.periodFrom")));
    await userEvent.keyboard("2026-03-01{Enter}");
    await userEvent.keyboard("2026-03-31{Enter}");
    await userEvent.click(within(bar).getByRole("button", { name: en("rpt.applyPeriod") }));
    await waitFor(() => expect(finishes).toHaveLength(2), WAIT);
    expect((await api.bodies(DATA)).slice(-2)).toEqual([
      { period: null, refresh: true },
      { period: { from: "2026-03-01", to: "2026-03-31" }, refresh: false },
    ]);
    await act(async () => { finishes[0]!(json(status, { code, message_key: `error.${code}` })); });
    await screen.findByText(en(code === "report_not_published" ? "rpt.unpublishedNow" : "rpt.loadFailed"), {}, WAIT);
    expect(screen.queryByRole("rowheader", { name: "Bangkok" })).toBeNull();
    expect(screen.queryByText(/4 documents · 1 excluded/)).toBeNull();
    expect(screen.queryByText(en("rpt.staleTitle"))).toBeNull();
    expect(csvSignal.aborted).toBe(true);
    expect(api.count(ONE)).toBe(code === "revision_conflict" ? 2 : 1);
    await act(async () => {
      finishes[1]!(json(200, RESULT({ period: { from: "2026-03-01", to: "2026-03-31" } })));
      finishCsv(new Response("category,value\nLate data,100\n", { status: 200 }));
    });
    expect(screen.queryByRole("rowheader", { name: "Bangkok" })).toBeNull();
    expect(screen.queryByText(/4 documents · 1 excluded/)).toBeNull();
    expect(screen.queryByRole("button", { name: en("rpt.csvOf", { title: "Sales by branch" }) })).toBeNull();
    expect(created).not.toHaveBeenCalled();
    if (code !== "report_not_published") {
      api.set(DATA, () => json(200, RESULT({ period: { from: "2026-03-01", to: "2026-03-31" } })));
      await userEvent.click(screen.getByRole("button", { name: en("common.retry") }));
      await screen.findByRole("rowheader", { name: "Bangkok" }, WAIT);
      expect(screen.queryByRole("alert")).toBeNull();
      expect((await api.bodies(DATA)).at(-1)).toEqual({ period: { from: "2026-03-01", to: "2026-03-31" }, refresh: true });
    }
  }, LONG);

  it.each(["permission_denied", "revision_conflict"] as const)("ignores a late old-publication %s without clearing or rechecking the new viewer (164-03)", async (code) => {
    let finishOld!: (response: Response) => void;
    const api = inOrg(VIEWER, { [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()) });
    const { queryClient } = renderAt("/report-view/31");
    await screen.findByRole("rowheader", { name: "Bangkok" }, WAIT);
    api.set(DATA, () => new Promise<Response>((resolve) => { finishOld = resolve; }));
    await userEvent.click(screen.getByRole("button", { name: en("rpt.refresh") }));
    await waitFor(() => expect(finishOld).toBeTypeOf("function"), WAIT);
    api.set(ONE, () => json(200, detail({ published: { ...detail().published!, name: "New overview", version: 3 } })));
    api.set(DATA, () => json(200, RESULT({ report_version: 3 })));
    await act(async () => { await queryClient.refetchQueries({ queryKey: ["report", 5, 31], exact: true }); });
    await screen.findByRole("heading", { name: "New overview" }, WAIT);
    await screen.findByRole("rowheader", { name: "Bangkok" }, WAIT);
    await act(async () => { finishOld(json(code === "revision_conflict" ? 409 : 403, { code, message_key: `error.${code}` })); });
    expect(screen.getByRole("rowheader", { name: "Bangkok" })).toBeInTheDocument();
    expect(screen.getByText(/4 documents · 1 excluded/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(api.count(ONE)).toBe(2);
    expect(api.count(DATA)).toBe(3);
  }, LONG);

  it("ignores a departed component's refusal even after the same publication is reopened (164-03)", async () => {
    let finishOld!: (response: Response) => void;
    const api = inOrg(VIEWER, {
      [LIST]: () => json(200, { items: [summary()] }), [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()),
    });
    renderAt("/report-view/31");
    await screen.findByRole("rowheader", { name: "Bangkok" }, WAIT);
    api.set(DATA, () => new Promise<Response>((resolve) => { finishOld = resolve; }));
    await userEvent.click(screen.getByRole("button", { name: en("rpt.refresh") }));
    await waitFor(() => expect(finishOld).toBeTypeOf("function"), WAIT);
    await userEvent.click(screen.getByRole("button", { name: new RegExp(`${en("rpt.backToList")}$`) }));
    await screen.findByRole("list", { name: en("nav.reportView") }, WAIT);
    api.set(DATA, () => json(200, RESULT()));
    await userEvent.click(screen.getByRole("link", { name: /Sales overview/ }));
    await screen.findByRole("rowheader", { name: "Bangkok" }, WAIT);
    expect(api.count(ONE)).toBe(2); // React Query rechecks stale metadata on reopening.
    await act(async () => { finishOld(json(409, { code: "revision_conflict", message_key: "error.revision_conflict" })); });
    expect(screen.getByRole("rowheader", { name: "Bangkok" })).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
    expect(api.count(ONE)).toBe(2);
    expect(api.count(DATA)).toBe(3);
  }, LONG);

  it.each([200, 403])("cancels CSV on same-version metadata export revocation before a late %s, retaining view access (163-03/164-03)", async (status) => {
    const created = vi.fn(() => "blob:export-revoked");
    vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: created, revokeObjectURL: vi.fn() }));
    const info = vi.spyOn(reportUi, "ReportCardInfo");
    try {
      let finishCsv!: (response: Response) => void;
      let csvSignal!: AbortSignal;
      const api = inOrg(VIEWER, {
        [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()),
        [CSV]: (r) => new Promise<Response>((resolve) => { finishCsv = resolve; csvSignal = r.signal; }),
      });
      const { queryClient } = renderAt("/report-view/31");
      await screen.findByRole("rowheader", { name: "Bangkok" }, WAIT);
      const csvName = en("rpt.csvOf", { title: "Sales by branch" });
      const actions = info.mock.calls.at(-1)![0].actions;
      if (!isValidElement<{ children?: ReactNode }>(actions)) throw new Error("Expected card actions");
      const exportButton = Children.toArray(actions.props.children).find((child) =>
        isValidElement<{ "aria-label"?: string }>(child) && child.props["aria-label"] === csvName);
      if (!isValidElement<{ onClick(): void }>(exportButton)) throw new Error("Expected CSV action");
      await userEvent.click(screen.getByRole("button", { name: csvName }));
      await waitFor(() => expect(finishCsv).toBeTypeOf("function"), WAIT);
      api.set(ONE, () => json(200, detail({ can_export: false })));
      await act(async () => { await queryClient.refetchQueries({ queryKey: ["report", 5, 31], exact: true }); });
      await waitFor(() => expect(screen.queryByRole("button", { name: csvName })).toBeNull(), WAIT);
      expect(csvSignal.aborted).toBe(true);
      expect(screen.getByRole("rowheader", { name: "Bangkok" })).toBeInTheDocument();
      expect(screen.getByText(/4 documents · 1 excluded/)).toBeInTheDocument();
      expect(screen.getByText(en("rpt.version", { n: 2 }))).toBeInTheDocument();
      expect(api.count(DATA)).toBe(1);
      await act(async () => {
        finishCsv(status === 200
          ? new Response("category,value\nLate file,100\n", { status: 200 })
          : json(403, { code: "permission_denied", message_key: "error.permission_denied" }));
      });
      // A retained old action must not bypass today's metadata permission either.
      act(() => exportButton.props.onClick());
      expect(api.count(CSV)).toBe(1);
      expect(api.count(ONE)).toBe(2);
      expect(api.count(DATA)).toBe(1);
      expect(created).not.toHaveBeenCalled();
      expect(screen.queryByRole("alert")).toBeNull();
      expect(screen.getByRole("rowheader", { name: "Bangkok" })).toBeInTheDocument();
      // Export-only revocation must not disable a subsequent authorized data refresh.
      await userEvent.click(screen.getByRole("button", { name: en("rpt.refresh") }));
      await waitFor(() => expect(api.count(DATA)).toBe(2), WAIT);
      await waitFor(() => expect(screen.getByRole("button", { name: en("rpt.refresh") })).toBeEnabled(), WAIT);
    } finally {
      info.mockRestore();
    }
  }, LONG);

  it("labels retained results by their successful period source through failed apply and reset (163-03/164-02)", async () => {
    let finish!: (response: Response) => void;
    const api = inOrg(VIEWER, { [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()) });
    renderAt("/report-view/31");
    await screen.findByRole("rowheader", { name: "Bangkok" }, WAIT);
    const bar = screen.getByRole("region", { name: en("rpt.periodBar") });
    const hint = new RegExp(en("rpt.periodAsPublished"));
    expect(within(bar).getByText(hint)).toBeInTheDocument();
    await userEvent.click(within(bar).getByPlaceholderText(en("rpt.periodFrom")));
    // Identical dates can come from either source; the result period alone cannot tell.
    await userEvent.keyboard("2026-01-01{Enter}");
    await userEvent.keyboard("2026-12-31{Enter}");
    await userEvent.click(within(bar).getByRole("button", { name: en("rpt.applyPeriod") }));
    await waitFor(() => expect(api.count(DATA)).toBe(2), WAIT);
    await waitFor(() => expect(screen.getByRole("button", { name: en("rpt.refresh") })).toBeEnabled(), WAIT);
    expect(within(bar).queryByText(hint)).toBeNull();
    expect((await api.bodies(DATA)).at(-1)).toEqual({ period: RESULT().period, refresh: false });
    let finishReset!: (response: Response) => void;
    api.set(DATA, () => new Promise<Response>((resolve) => { finishReset = resolve; }));
    await userEvent.click(within(bar).getByRole("button", { name: en("rpt.resetPeriod") }));
    await waitFor(() => expect(finishReset).toBeTypeOf("function"), WAIT);
    expect(within(bar).queryByText(hint)).toBeNull();
    await act(async () => { finishReset(json(503, { code: "unavailable", message_key: "error.unavailable" })); });
    const alert = await screen.findByRole("alert", {}, WAIT);
    expect(alert).toHaveTextContent(en("rpt.staleBody", { at: formatBangkokDateTime(RESULT().generated_at) }));
    expect(screen.getByRole("rowheader", { name: "Bangkok" })).toBeInTheDocument();
    expect(within(bar).getByText(/2026-01-01 – 2026-12-31/)).toBeInTheDocument();
    expect(within(bar).queryByText(hint)).toBeNull();
    expect(screen.getByRole("button", { name: en("rpt.csvOf", { title: "Sales by branch" }) })).toBeDisabled();
    api.set(DATA, () => json(200, RESULT()));
    await userEvent.click(within(alert).getByRole("button", { name: en("common.retry") }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull(), WAIT);
    expect(within(bar).getByText(hint)).toBeInTheDocument();
    expect((await api.bodies(DATA)).at(-1)).toEqual({ period: null, refresh: true });
    await userEvent.click(within(bar).getByPlaceholderText(en("rpt.periodFrom")));
    await userEvent.keyboard("2026-01-01{Enter}");
    await userEvent.keyboard("2026-12-31{Enter}");
    api.set(DATA, () => new Promise<Response>((resolve) => { finish = resolve; }));
    await userEvent.click(within(bar).getByRole("button", { name: en("rpt.applyPeriod") }));
    await waitFor(() => expect(finish).toBeTypeOf("function"), WAIT);
    expect(within(bar).getByText(hint)).toBeInTheDocument();
    await act(async () => { finish(json(503, { code: "unavailable", message_key: "error.unavailable" })); });
    await screen.findByText(en("rpt.staleTitle"), {}, WAIT);
    expect(within(bar).getByText(hint)).toBeInTheDocument();
    api.set(DATA, () => json(200, RESULT()));
    await userEvent.click(screen.getByRole("button", { name: en("common.retry") }));
    await waitFor(() => expect(screen.queryByRole("alert")).toBeNull(), WAIT);
    expect(within(bar).queryByText(hint)).toBeNull();
    expect((await api.bodies(DATA)).at(-1)).toEqual({ period: RESULT().period, refresh: true });
  }, LONG);
});

describe("published report view (FR-REPORT-002, -010, -015, -016)", () => {
  it("pages raw records without changing the publication (FR-REPORT-022)", async () => {
    const api = inOrg(VIEWER, {
      [ONE]: () => json(200, detail()),
      [DATA]: async (r) => {
        const body = await r.json();
        const page = body.pages?.c1 ?? 1;
        return json(200, RESULT({ cards: [{ card_id: "c1", status: "ok", rows: [], table: { columns: [{ key: "item", label: "Item", type: "string" }], rows: [{ item: page === 1 ? "First item" : "Second item" }], page, page_size: 5, total: 6 } }] }));
      },
    });
    renderAt("/reports/31");
    expect(await screen.findByText("First item", {}, WAIT)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("Second item", {}, WAIT)).toBeInTheDocument();
    expect(await api.bodies(DATA)).toEqual([{ period: null, refresh: false }, { period: { from: "2026-01-01", to: "2026-12-31" }, refresh: false, pages: { c1: 2 } }]);
    expect(api.count("PUT /api/v1/reports/31")).toBe(0);
  }, LONG);

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

  it.each([401, 402, 403, 404])(
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

  it.each([401, 402, 403, 404, 409])("clears values when a CSV refusal reveals revoked report access (%s)", async (status) => {
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
  const catalog = { "GET /api/v1/reports/catalog/templates": () => json(200, { items: [] }), "GET /api/v1/data-sources": () => json(200, { items: [] }) };

  it("pages the raw preview without editing the draft (FR-REPORT-022)", async () => {
    const api = inOrg(DESIGNER, {
      ...catalog, [ONE]: () => json(200, draftDetail()),
      "POST /api/v1/reports/31/preview": async (r) => {
        const body = await r.json();
        const page = body.pages?.c1 ?? 1;
        return json(200, RESULT({ report_version: null, cards: [{ card_id: "c1", status: "ok", rows: [], table: { columns: [{ key: "item", label: "Item", type: "string" }], rows: [{ item: page === 1 ? "First item" : "Second item" }], page, page_size: 5, total: 6 } }] }));
      },
    });
    renderAt("/reports/31/design");
    await userEvent.click(await screen.findByRole("button", { name: en("rpt.preview") }, WAIT));
    expect(await screen.findByText("First item", {}, WAIT)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("Second item", {}, WAIT)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en("rpt.saveDraft") })).toBeDisabled();
    const bodies = await api.bodies("POST /api/v1/reports/31/preview");
    expect(bodies).toEqual([{ config: CONFIG, period: null }, { config: CONFIG, period: { from: "2026-01-01", to: "2026-12-31" }, pages: { c1: 2 } }]);
  }, LONG);

  it("binds the SQL catalog and discovers raw table fields (FR-REPORT-023)", async () => {
    const api = inOrg({ ...DESIGNER, permissions: ["report_manage", "data_browse"] }, {
      ...catalog, [ONE]: () => json(200, draftDetail()),
      "GET /api/v1/data-sources": () => json(200, { items: [{ id: "postgres:1", name: "ERP", kind: "postgresql", enabled: true }] }),
      "POST /api/v1/data-sources/postgres%3A1/query": () => json(200, { columns: [{ key: "item", label: "Item", type: "string" }], rows: [], page: 1, page_size: 20, total: 0 }),
    });
    renderAt("/reports/31/design");
    await userEvent.click(await screen.findByRole("button", { name: "Sales by branch" }, WAIT));
    await userEvent.click(screen.getByRole("combobox", { name: "Data source" }));
    await userEvent.click(await screen.findByText("ERP · PostgreSQL", {}, WAIT));
    await userEvent.click(screen.getByRole("combobox", { name: "Query mode" }));
    await userEvent.click(await screen.findByText("Write SQL", {}, WAIT));
    await userEvent.type(screen.getByLabelText("SQL"), "SELECT item FROM inventory");
    await userEvent.click(screen.getByRole("button", { name: "Run and discover fields" }));
    expect(await screen.findByText("Result fields discovered: 1", {}, WAIT)).toBeInTheDocument();
    expect(await api.bodies("POST /api/v1/data-sources/postgres%3A1/query")).toEqual([{ sql: "SELECT item FROM inventory", page: 1, page_size: 20 }]);
  }, LONG);

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
