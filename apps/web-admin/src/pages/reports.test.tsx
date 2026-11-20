import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { ReportDetail, ReportSummary } from "../services/reports";
import { useLanguage } from "../stores/language";
import { json } from "../test/mockApi";
import { renderAt, signedIn, userEvent, zh } from "../test/admin";

const LONG = 30_000;
const WAIT = { timeout: 10_000 };
const T0 = "2026-11-01T03:00:00Z";

const ORGS = "GET /api/v1/admin/organizations";
const LIST = "GET /api/v1/admin/reports";
const ONE = "GET /api/v1/admin/reports/31";
const SAVE = "PUT /api/v1/admin/reports/31";
const PUBLISH = "POST /api/v1/admin/reports/31/publish";
const PREVIEW = "POST /api/v1/admin/reports/31/preview";
const CATALOG = "GET /api/v1/admin/reports/catalog/templates";

function org(tenant_id: number, name: string) {
  return {
    tenant_id, name, contact_phone: "0812345678", address: "Bangkok", status: "active",
    verification_status: "verified", member_count: 3, created_at: T0,
  };
}

const CONFIG = {
  version: 1,
  period: { mode: "current_year" },
  grid: { cols: 12, row_height: 80 },
  cards: [
    {
      id: "c1",
      type: "metric",
      title: "Total sales",
      layout: { x: 0, y: 0, w: 4, h: 2 },
      data: {
        template_id: 12,
        template_version_ids: [101],
        grain: "document",
        measure: { path: "header.total", agg: "sum" },
        dimension: { kind: "none" },
        date_field: { path: "header.date" },
        unit: { mode: "fixed", value: "THB" },
      },
      style: { precision: 2 },
    },
  ],
};

const detail = (over: Partial<ReportDetail> = {}): ReportDetail => ({
  id: 31,
  tenant_id: 5,
  name: "Sales overview",
  status: "changed",
  revision: 4,
  can_manage: true,
  can_export: false,
  created_at: T0,
  updated_at: T0,
  draft: CONFIG,
  draft_errors: [],
  published: { name: "Sales overview", config: CONFIG, published_at: "2026-11-10T03:00:00Z", version: 2 },
  sources: [],
  ...over,
});

const summary = (over: Partial<ReportSummary> = {}): ReportSummary => ({
  id: 31,
  name: "Sales overview",
  status: "published",
  revision: 4,
  can_manage: true,
  published_version: 2,
  published_at: "2026-11-10T03:00:00Z",
  updated_at: T0,
  ...over,
});

const SYNTHETIC = {
  generated_at: "2026-11-11T02:00:00Z",
  period: { from: "2026-01-01", to: "2026-12-31" },
  scope: "synthetic",
  synthetic: true,
  report_version: null,
  cards: [
    {
      card_id: "c1",
      status: "ok",
      period_applied: true,
      rows: [{ dimension: null, series: null, unit: "THB", value: "1234.5", count: 3 }],
      diagnostics: { documents: 3, excluded: {} },
    },
  ],
};

const base = {
  [ORGS]: () => json(200, [org(5, "Siam Tools"), org(6, "Bangkok Trading")]),
  "GET /api/v1/admin/organizations/5": () => json(200, org(5, "Siam Tools")),
  [CATALOG]: () => json(200, { items: [] }),
};

/** No call of the admin may read customer statistics or CSV (AC-FR-SYS-143-01). */
function noBusinessData(calls: Request[]) {
  for (const c of calls) {
    const path = new URL(c.url).pathname;
    expect(path).not.toMatch(/\/data$|\/csv$/);
    expect(path.startsWith("/api/v1/reports")).toBe(false);
  }
}

async function pick(label: string, option: string) {
  await userEvent.click(screen.getByLabelText(label));
  const item = await waitFor(() => {
    const found = document.querySelector<HTMLElement>(`.ant-select-item-option[title="${option}"]`);
    if (!found) throw new Error(`no option ${option}`);
    return found;
  });
  await userEvent.click(item);
}

const endsWith = (text: string) => new RegExp(`${text}$`);

beforeEach(() => {
  localStorage.clear();
  useLanguage.getState().setLang("zh");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("admin report list (FR-SYS-143)", () => {
  it(
    "lists the chosen organization's reports from the menu",
    async () => {
      const api = signedIn({ ...base, [LIST]: () => json(200, { items: [summary()] }) });
      renderAt("/reports");
      const page = await screen.findByTestId("page-reports", {}, WAIT);
      expect(within(page).getByText(zh("rpa.note"))).toBeInTheDocument();
      expect(within(page).getByText(zh("rpa.chooseOrg"))).toBeInTheDocument();
      expect(api.count(LIST)).toBe(0);
      const nav = screen.getByRole("navigation", { name: zh("layout.mainNav") });
      expect(within(nav).getByRole("link", { name: zh("nav.reports") })).toHaveAttribute("href", "/reports");

      await pick(zh("rpa.org"), "Siam Tools");
      const link = await screen.findByRole("link", { name: "Sales overview" }, WAIT);
      expect(link).toHaveAttribute("href", "/reports/31");
      const row = link.closest("tr") as HTMLElement;
      expect(within(row).getByText(zh("rpt.status.published"))).toBeInTheDocument();
      expect(within(row).getByText(/v2/)).toBeInTheDocument();
      const listed = api.calls.find((c) => new URL(c.url).pathname === "/api/v1/admin/reports")!;
      expect(new URL(listed.url).searchParams.get("tenant_id")).toBe("5");
      noBusinessData(api.calls);
    },
    LONG,
  );

  it(
    "creates a report for the organization and opens its designer",
    async () => {
      const api = signedIn({
        ...base,
        [LIST]: () => json(200, { items: [] }),
        "POST /api/v1/admin/reports": () => json(201, detail({ status: "draft", published: null, draft: null, revision: 1 })),
        [ONE]: () => json(200, detail({ status: "draft", published: null, draft: null, revision: 1 })),
      });
      renderAt("/reports?tenant=5");
      expect(await screen.findByText(zh("rpa.empty"), {}, WAIT)).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: zh("rpt.new") }));
      await userEvent.type(await screen.findByLabelText(zh("rpt.name")), "  Monthly sales ");
      await userEvent.click(screen.getByRole("button", { name: zh("rpt.create") }));
      expect(await screen.findByRole("region", { name: zh("rpt.toolbar") }, WAIT)).toBeInTheDocument();
      expect(await api.bodies("POST /api/v1/admin/reports")).toEqual([{ tenant_id: 5, name: "Monthly sales" }]);
      expect(await screen.findByText(zh("rpa.orgOf", { name: "Siam Tools" }), {}, WAIT)).toBeInTheDocument();
    },
    LONG,
  );

  it(
    "links an organization to its report configuration",
    async () => {
      signedIn(base);
      renderAt("/organizations/5");
      const link = await screen.findByRole("link", { name: zh("rpa.reports") }, WAIT);
      expect(link).toHaveAttribute("href", "/reports?tenant=5");
    },
    LONG,
  );
});

describe("admin report designer (FR-SYS-143)", () => {
  it(
    "previews over synthetic rows only, labelled as such",
    async () => {
      const api = signedIn({ ...base, [ONE]: () => json(200, detail()), [PREVIEW]: () => json(200, SYNTHETIC) });
      renderAt("/reports/31");
      const toolbar = await screen.findByRole("region", { name: zh("rpt.toolbar") }, WAIT);
      expect(within(toolbar).getByText(zh("rpa.previewNote"))).toBeInTheDocument();
      expect(screen.getByText(zh("rpa.changedNote", { n: 2 }))).toBeInTheDocument();
      expect(screen.getByRole("link", { name: zh("rpt.backToList") })).toHaveAttribute("href", "/reports?tenant=5");
      await userEvent.click(within(toolbar).getByRole("button", { name: zh("rpt.preview") }));
      expect(await screen.findByText(zh("rpd.previewSynthetic"), {}, WAIT)).toBeInTheDocument();
      expect(await api.bodies(PREVIEW)).toEqual([{ config: CONFIG, period: null }]);
      const catalog = api.calls.find((c) => new URL(c.url).pathname === "/api/v1/admin/reports/catalog/templates")!;
      expect(new URL(catalog.url).searchParams.get("tenant_id")).toBe("5");
      expect(new URL(catalog.url).searchParams.get("report_id")).toBe("31");
      noBusinessData(api.calls);
    },
    LONG,
  );

  it(
    "saves the renamed draft with its revision",
    async () => {
      const api = signedIn({
        ...base,
        [ONE]: () => json(200, detail()),
        [SAVE]: () => json(200, detail({ name: "Sales 2026", revision: 5 })),
      });
      renderAt("/reports/31");
      const toolbar = await screen.findByRole("region", { name: zh("rpt.toolbar") }, WAIT);
      expect(within(toolbar).getByRole("button", { name: zh("rpt.saveDraft") })).toBeDisabled();
      const name = within(toolbar).getByRole("textbox");
      await userEvent.clear(name);
      expect(within(toolbar).getByText(zh("rpt.nameRequired"))).toBeInTheDocument();
      expect(within(toolbar).getByRole("button", { name: zh("rpt.publish") })).toBeDisabled();
      await userEvent.type(name, "Sales 2026");
      await userEvent.click(within(toolbar).getByRole("button", { name: zh("rpt.saveDraft") }));
      expect(await screen.findByText(zh("rpt.saved"), {}, WAIT)).toBeInTheDocument();
      const [sent] = (await api.bodies(SAVE)) as { revision: number; name: string; config: unknown }[];
      expect(sent).toMatchObject({ revision: 4, name: "Sales 2026" });
      expect(sent!.config).toEqual(CONFIG);
    },
    LONG,
  );

  it(
    "shows a refused publication, keeps the old one, then publishes once fixed",
    async () => {
      const api = signedIn({
        ...base,
        [ONE]: () => json(200, detail()),
        [PUBLISH]: () =>
          json(422, {
            code: "report_invalid",
            message_key: "error.report_invalid",
            details: { errors: [{ path: "cards[0].data.template_id", message: "need_template", card_id: "c1" }] },
          }),
      });
      renderAt("/reports/31");
      const toolbar = await screen.findByRole("region", { name: zh("rpt.toolbar") }, WAIT);
      await userEvent.click(within(toolbar).getByRole("button", { name: zh("rpt.publish") }));
      expect(await screen.findByText(zh("rpt.publishRefused", { n: 1 }), {}, WAIT)).toBeInTheDocument();
      expect(api.count(SAVE)).toBe(0);
      expect(await api.bodies(PUBLISH)).toEqual([{ revision: 4 }]);
      expect(screen.getByText(zh("rpt.publishedMeta", { n: 2, at: "2026-11-10 10:00" }), { exact: false })).toBeInTheDocument();

      api.set(PUBLISH, () => json(200, detail({ status: "published", revision: 5 })));
      await userEvent.click(within(toolbar).getByRole("button", { name: endsWith(zh("rpt.publish")) }));
      expect(await screen.findByText(zh("rpt.published"), {}, WAIT)).toBeInTheDocument();
      expect(screen.queryByText(zh("rpt.publishRefused", { n: 1 }))).toBeNull();
    },
    LONG,
  );

  it(
    "offers a reload on a revision conflict without overwriting",
    async () => {
      const api = signedIn({
        ...base,
        [ONE]: () => json(200, detail()),
        [SAVE]: () => json(409, { code: "revision_conflict", message_key: "error.revision_conflict" }),
      });
      renderAt("/reports/31");
      const toolbar = await screen.findByRole("region", { name: zh("rpt.toolbar") }, WAIT);
      await userEvent.type(within(toolbar).getByRole("textbox"), "!");
      await userEvent.click(within(toolbar).getByRole("button", { name: zh("rpt.saveDraft") }));
      expect(await screen.findByText(zh("rpt.conflict"), {}, WAIT)).toBeInTheDocument();
      const before = api.count(ONE);
      await userEvent.click(screen.getByRole("button", { name: zh("rpt.reload") }));
      await userEvent.click(await screen.findByRole("button", { name: zh("common.confirm") }));
      await waitFor(() => expect(api.count(ONE)).toBe(before + 1), WAIT);
      await waitFor(() => expect(screen.queryByText(zh("rpt.conflict"))).toBeNull(), WAIT);
      expect(within(toolbar).getByRole("textbox")).toHaveValue("Sales overview");
    },
    LONG,
  );

  it(
    "unpublishes and deletes with the current revision, back to the organization's list",
    async () => {
      const api = signedIn({
        ...base,
        [ONE]: () => json(200, detail()),
        "POST /api/v1/admin/reports/31/unpublish": () => json(200, detail({ status: "draft", published: null, revision: 5 })),
        "DELETE /api/v1/admin/reports/31": () => json(204, null),
        [LIST]: () => json(200, { items: [] }),
      });
      renderAt("/reports/31");
      await userEvent.click(await screen.findByRole("button", { name: zh("rpt.unpublish") }, WAIT));
      expect(await screen.findByText(zh("rpa.unpublishTitle"))).toBeInTheDocument();
      await userEvent.click(screen.getByRole("button", { name: zh("common.confirm") }));
      expect(await screen.findByText(zh("rpt.unpublished"), {}, WAIT)).toBeInTheDocument();
      expect(await api.bodies("POST /api/v1/admin/reports/31/unpublish")).toEqual([{ revision: 4 }]);
      await waitFor(() => expect(screen.queryByRole("button", { name: zh("rpt.unpublish") })).toBeNull(), WAIT);

      await userEvent.click(screen.getByRole("button", { name: zh("rpt.delete") }));
      expect(await screen.findByText(zh("rpa.deleteBody"))).toBeInTheDocument();
      const confirms = await screen.findAllByRole("button", { name: zh("common.confirm") });
      await userEvent.click(confirms[confirms.length - 1]!);
      expect(await screen.findByText(zh("rpa.empty"), {}, WAIT)).toBeInTheDocument();
      const removed = api.calls.find((c) => c.method === "DELETE")!;
      expect(new URL(removed.url).searchParams.get("revision")).toBe("5");
      const listed = api.calls.find((c) => new URL(c.url).pathname === "/api/v1/admin/reports")!;
      expect(new URL(listed.url).searchParams.get("tenant_id")).toBe("5");
    },
    LONG,
  );

  it(
    "says a missing report is not found",
    async () => {
      signedIn(base);
      renderAt("/reports/99");
      expect(await screen.findByText(zh("rpt.notFound"), {}, WAIT)).toBeInTheDocument();
    },
    LONG,
  );
});
