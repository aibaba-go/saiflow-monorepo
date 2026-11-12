import { screen, waitFor, within } from "@testing-library/react";
import userEventLib from "@testing-library/user-event";
import { act } from "react";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Shell } from "../../App";
import { useLanguage } from "../../stores/language";
import { useSession, type UsableTenant } from "../../stores/session";
import { testAuth } from "../../test/auth";
import { fakeLiff } from "../../test/fakeLiff";
import { ORG, PERSONAL, signedIn, USER } from "../../test/fixtures";
import { json, mockApi } from "../../test/mockApi";
import { renderWithProviders } from "../../test/render";
import { useTenantChoice } from "../tenants/useCurrentTenant";
import type { ReportDetail, ReportSummary } from "./api";
import { ReportDetailPage } from "./ReportDetailPage";
import { ReportListPage } from "./ReportListPage";

const userEvent = userEventLib.setup({ pointerEventsCheck: 0 });
const T0 = "2026-11-01T03:00:00Z";
const VIEWER: UsableTenant = { ...ORG, permissions: ["upload_ocr", "verify_own", "report_view", "export"] };
const NO_EXPORT: UsableTenant = { ...ORG, permissions: ["upload_ocr", "report_view"] };
const OTHER: UsableTenant = { ...VIEWER, tenant_id: 6, name: "Chao Phraya Parts" };

const ONE = "GET /api/v1/reports/31";
const DATA = "POST /api/v1/reports/31/data";
const CSV = "GET /api/v1/reports/31/csv";
const TICKET = "POST /api/v1/reports/31/csv/ticket";

const card = (id: string, title: string, x: number, y: number) => ({
  id,
  type: "table",
  title,
  layout: { x, y, w: 6, h: 4 },
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
});

// stored out of order: B (top right), C (second row), A (top left)
const CONFIG = {
  version: 1,
  period: { mode: "current_year" },
  grid: { cols: 12, row_height: 80 },
  cards: [card("c_b", "B sales", 6, 0), card("c_c", "C sales", 0, 4), card("c_a", "A sales", 0, 0)],
};

const rows = (city: string) => ({
  status: "ok",
  period_applied: true,
  rows: [{ dimension: city, series: null, unit: "THB", value: "1500.5", count: 3 }],
  diagnostics: { documents: 3, excluded: { invalid_number: 1 } },
});

const RESULT = (over: Record<string, unknown> = {}) => ({
  generated_at: "2026-11-11T02:00:00Z",
  period: { from: "2026-01-01", to: "2026-12-31" },
  scope: "own",
  synthetic: false,
  report_version: 2,
  cards: [
    { card_id: "c_a", ...rows("Bangkok") },
    { card_id: "c_b", ...rows("Chiang Mai") },
    { card_id: "c_c", ...rows("Phuket") },
  ],
  ...over,
});

const detail = (over: Partial<ReportDetail> = {}): ReportDetail => ({
  id: 31,
  tenant_id: 5,
  name: "Sales overview (draft name)",
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

function pages(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/report" element={<ReportListPage />} />
      <Route path="/report/:id" element={<ReportDetailPage />} />
    </Routes>,
    { route },
  );
}

function inOrg(tenant: UsableTenant = VIEWER, others: UsableTenant[] = []) {
  signedIn(USER, [PERSONAL, tenant, ...others]);
  useTenantChoice.getState().choose(tenant.tenant_id);
}

const cardTitles = () =>
  within(screen.getByRole("list", { name: "Report charts" }))
    .getAllByRole("heading")
    .map((h) => h.textContent);

beforeEach(() => {
  localStorage.clear();
  useSession.getState().reset();
  useTenantChoice.getState().choose(null);
  useLanguage.getState().setLang("en");
});

describe("LINE report list (FR-SYS-056)", () => {
  it("lists only the published reports and opens one", async () => {
    testAuth();
    inOrg();
    mockApi({
      "GET /api/v1/reports": () =>
        json(200, {
          items: [
            summary(),
            summary({ id: 32, name: "Draft only", status: "draft", published_version: null, published_at: null }),
          ],
        }),
      [ONE]: () => json(200, detail()),
      [DATA]: () => json(200, RESULT()),
    });
    pages("/report");
    const list = await screen.findByRole("list", { name: "Published reports" });
    expect(within(list).getAllByRole("button")).toHaveLength(1);
    expect(screen.queryByText("Draft only")).toBeNull();
    expect(screen.getByText("Siam Tools · Reports published in this workspace")).toBeInTheDocument();
    expect(screen.getByText("Published v2 · 2026-11-10 10:00")).toBeInTheDocument();
    // no designer in LINE
    expect(screen.queryByRole("button", { name: /new|design/i })).toBeNull();
    await userEvent.click(within(list).getByRole("button", { name: /Sales overview/ }));
    expect(await screen.findByRole("heading", { level: 1, name: "Sales overview" })).toBeInTheDocument();
  });

  it("tells empty and failed apart, and retries", async () => {
    testAuth();
    inOrg();
    let fail = true;
    const api = mockApi({
      "GET /api/v1/reports": () =>
        fail ? json(500, { code: "internal", message_key: "error.internal" }) : json(200, { items: [] }),
    });
    pages("/report");
    expect(await screen.findByText("The report data could not be loaded")).toBeInTheDocument();
    fail = false;
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("No published reports yet.")).toBeInTheDocument();
    expect(api.count("GET /api/v1/reports")).toBe(2);
  });
});

describe("LINE report detail (FR-REPORT-018, -010, -015, -016)", () => {
  it("shows the cards in one column by y, x and id (018-01), with the facts and no designer", async () => {
    testAuth();
    inOrg();
    const api = mockApi({ [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()) });
    pages("/report/31");
    expect(await screen.findByText("Bangkok")).toBeInTheDocument();
    expect(cardTitles()).toEqual(["A sales", "B sales", "C sales"]);
    expect(screen.getByText("Only documents you submitted")).toBeInTheDocument();
    expect(screen.getByText(/2026-01-01 – 2026-12-31/)).toBeInTheDocument();
    expect(screen.getByText(/does not refresh by itself/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /^(design|publish|save)/i })).toBeNull();
    expect(await api.bodies(DATA)).toEqual([{ period: null, refresh: false }]);
  });

  it("refreshes only by hand, and keeps the older result marked when a refresh fails (015)", async () => {
    testAuth();
    inOrg();
    let fail = false;
    const api = mockApi({
      [ONE]: () => json(200, detail()),
      [DATA]: () =>
        fail ? json(503, { code: "service_unavailable", message_key: "error.service_unavailable" }) : json(200, RESULT()),
    });
    pages("/report/31");
    expect(await screen.findByText("Bangkok")).toBeInTheDocument();
    fail = true;
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByText("Refresh failed — the charts show older data")).toBeInTheDocument();
    expect(screen.getByText("Bangkok")).toBeInTheDocument();
    // CSV of an older result is not offered
    expect(screen.getByRole("button", { name: "Download CSV of A sales" })).toBeDisabled();
    fail = false;
    await userEvent.click(within(screen.getByRole("alert")).getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(screen.queryByText("Refresh failed — the charts show older data")).toBeNull());
    expect(await api.bodies(DATA)).toEqual([
      { period: null, refresh: false },
      { period: null, refresh: true },
      { period: null, refresh: true },
    ]);
  });

  it.each([401, 403, 404])("clears old statistics and the details sheet after a refused refresh (%s, 003)", async (status) => {
    testAuth();
    inOrg();
    let fail = false;
    let refuse!: (response: Response) => void;
    mockApi({
      [ONE]: () => json(200, detail()),
      [DATA]: () => fail ? new Promise<Response>((resolve) => { refuse = resolve; }) : json(200, RESULT()),
    });
    pages("/report/31");
    await screen.findByText("Bangkok");
    fail = true;
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await userEvent.click(screen.getByRole("button", { name: "Details of A sales" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => { refuse(json(status, { code: "permission_denied", message_key: "error.permission_denied" })); });
    await waitFor(() => expect(screen.queryByText("Bangkok")).toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByText("Refresh failed — the charts show older data")).toBeNull();
    expect(screen.queryByRole("button", { name: "Download CSV of A sales" })).toBeNull();
  });

  it("overrides the page period and goes back to the published one (010)", async () => {
    testAuth();
    inOrg();
    const api = mockApi({
      [ONE]: () => json(200, detail()),
      [DATA]: async (r) => {
        const body = (await r.json()) as { period: { from: string; to: string } | null };
        return json(200, RESULT(body.period ? { period: body.period } : {}));
      },
    });
    pages("/report/31");
    expect(await screen.findByText("Bangkok")).toBeInTheDocument();
    const apply = screen.getByRole("button", { name: "Apply" });
    expect(apply).toBeDisabled();
    const from = screen.getByLabelText("From");
    const to = screen.getByLabelText("To");
    await userEvent.type(from, "2026-03-31");
    await userEvent.type(to, "2026-03-01");
    expect(screen.getByText(/the end not before the start/)).toBeInTheDocument();
    expect(apply).toBeDisabled();
    await userEvent.clear(to);
    await userEvent.type(to, "2026-04-30");
    await userEvent.click(apply);
    expect(await screen.findByText("2026-03-31 – 2026-04-30")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "As published" }));
    expect(await screen.findByText(/2026-01-01 – 2026-12-31/)).toBeInTheDocument();
    expect(await api.bodies(DATA)).toEqual([
      { period: null, refresh: false },
      { period: { from: "2026-03-31", to: "2026-04-30" }, refresh: false },
      { period: null, refresh: false },
    ]);
  });

  it("CSV in LINE prepares the file without any browser-download action or ticket (016, 144)", async () => {
    const liff = testAuth(fakeLiff({ loggedIn: true, inClient: true }));
    inOrg();
    const api = mockApi({
      [ONE]: () => json(200, detail()),
      [DATA]: () => json(200, RESULT()),
      [CSV]: () => new Response("category,value\nChiang Mai,1500.5\n", { status: 200, headers: { "Content-Type": "text/csv" } }),
      [TICKET]: () => json(200, { url: "/api/v1/report-downloads/abc.def" }),
    });
    pages("/report/31");
    await userEvent.click(await screen.findByRole("button", { name: "Download CSV of B sales" }));
    const sheet = await screen.findByRole("dialog", { name: "CSV ready" });
    expect(liff.openWindow).not.toHaveBeenCalled();
    expect(api.count(TICKET)).toBe(0);
    expect(within(sheet).getByRole("button", { name: "Save or share" })).toBeInTheDocument();
    expect(within(sheet).queryByRole("button", { name: "Download in browser" })).toBeNull();
    expect(within(sheet).queryByText(/LINE will ask whether to open another app/)).toBeNull();
    expect(api.count(CSV)).toBe(1);
  });

  it("CSV outside LINE saves the file; a refused export says why (016)", async () => {
    testAuth(fakeLiff({ loggedIn: true, inClient: false }));
    inOrg();
    const created = vi.fn(() => "blob:x");
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: () => {} });
    let refuse = false;
    const api = mockApi({
      [ONE]: () => json(200, detail()),
      [DATA]: () => json(200, RESULT()),
      [CSV]: () =>
        refuse
          ? json(422, { code: "report_export_failed", message_key: "x", details: { error_code: "group_limit" } })
          : new Response(new Blob(["a,b"]), { status: 200, headers: { "Content-Type": "text/csv" } }),
    });
    pages("/report/31");
    await userEvent.click(await screen.findByRole("button", { name: "Download CSV of A sales" }));
    expect(await screen.findByText("CSV downloaded")).toBeInTheDocument();
    expect(created).toHaveBeenCalled();
    expect(new URL(api.calls.find((c) => c.method === "GET" && c.url.includes("/csv"))!.url).searchParams.get("card_id")).toBe(
      "c_a",
    );
    refuse = true;
    await userEvent.click(screen.getByRole("button", { name: "Download CSV of C sales" }));
    expect(await screen.findByText(/The CSV could not be created\. .+/)).toBeInTheDocument();
  });

  describe("keeping the CSV inside LINE: share or copy, with no browser fallback (FR-SYS-144)", () => {
    let share: ReturnType<typeof vi.fn>;
    beforeEach(() => {
      share = vi.fn(async () => {});
      Object.defineProperty(navigator, "canShare", { configurable: true, value: () => true });
      Object.defineProperty(navigator, "share", { configurable: true, value: share });
      return () => {
        Reflect.deleteProperty(navigator, "canShare");
        Reflect.deleteProperty(navigator, "share");
      };
    });
    const csvOk = () =>
      new Response("category,value\nChiang Mai,1500.5\n", { status: 200, headers: { "Content-Type": "text/csv" } });

    it("prepares the file with the session and shares it on tap, without the phone browser (144-01)", async () => {
      const liff = testAuth(fakeLiff({ loggedIn: true, inClient: true }));
      inOrg();
      const api = mockApi({ [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()), [CSV]: csvOk });
      pages("/report/31");
      await userEvent.click(await screen.findByRole("button", { name: "Download CSV of B sales" }));
      const sheet = await screen.findByRole("dialog", { name: "CSV ready" });
      const url = new URL(api.calls.find((c) => c.method === "GET" && c.url.includes("/csv"))!.url);
      expect(url.searchParams.get("card_id")).toBe("c_b");
      expect(url.searchParams.get("report_version")).toBe("2");
      expect(url.searchParams.get("from")).toBe("2026-01-01");
      expect(within(sheet).getByText(/B sales/)).toBeInTheDocument();
      await userEvent.click(within(sheet).getByRole("button", { name: "Save or share" }));
      expect(share).toHaveBeenCalledTimes(1);
      const [{ files }] = share.mock.calls[0] as [{ files: File[] }];
      expect(files.map((f) => [f.name, f.type])).toEqual([["report-31-c_b.csv", "text/csv"]]);
      // the shared file carries exactly the bytes the API returned
      expect(files[0]!.size).toBe("category,value\nChiang Mai,1500.5\n".length);
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(api.count(TICKET)).toBe(0);
      expect(liff.openWindow).not.toHaveBeenCalled();
    });

    it("without file sharing it previews the CSV and copies it, never opening the browser (144-02)", async () => {
      Object.defineProperty(navigator, "canShare", { configurable: true, value: () => false });
      const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
      const liff = testAuth(fakeLiff({ loggedIn: true, inClient: true }));
      inOrg();
      const body = "\ufeffReport,Sales overview\r\n\r\ncategory,value\r\n\"Chiang Mai, North\",1500.5\r\n";
      const api = mockApi({
        [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()),
        [CSV]: () => new Response(body, { status: 200, headers: { "Content-Type": "text/csv" } }),
      });
      try {
        pages("/report/31");
        await userEvent.click(await screen.findByRole("button", { name: "Download CSV of A sales" }));
        const sheet = await screen.findByRole("dialog", { name: "CSV ready" });
        expect(within(sheet).getByRole("button", { name: "Save or share" })).toBeInTheDocument();
        expect(within(sheet).queryByRole("button", { name: "Download in browser" })).toBeNull();
        // the preview parses quoted cells and skips the blank separator row
        const preview = within(sheet).getByRole("region", { name: "Preview" });
        expect(within(preview).getByText("Chiang Mai, North")).toBeInTheDocument();
        expect(within(preview).getAllByRole("row")).toHaveLength(3);
        await userEvent.click(within(sheet).getByRole("button", { name: "Copy CSV" }));
        await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
        // the whole file, without the byte-order mark the server adds for Excel
        expect(writeText.mock.calls[0]![0]).toBe(body.slice(1));
        expect(await screen.findByText(/CSV copied/)).toBeInTheDocument();
        expect(screen.getByRole("dialog", { name: "CSV ready" })).toBeInTheDocument();
        expect(api.count(TICKET)).toBe(0);
        expect(liff.openWindow).not.toHaveBeenCalled();
      } finally {
        Reflect.deleteProperty(navigator, "clipboard");
      }
    });

    it("copies with the copy command inside the sheet and shows only the first 50 rows (144-02)", async () => {
      Object.defineProperty(navigator, "canShare", { configurable: true, value: () => false });
      const writeText = vi.fn<(text: string) => Promise<void>>(async () => {});
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
      let copied = "";
      const exec = vi.fn((cmd: string) => {
        // the box must be focused inside the dialog, or the sheet's focus trap would steal it
        const box = document.querySelector("textarea");
        copied = cmd === "copy" && box && document.activeElement === box && box.closest("[role=dialog]") ? box.value : "";
        return copied !== "";
      });
      Object.defineProperty(document, "execCommand", { configurable: true, value: exec });
      testAuth(fakeLiff({ loggedIn: true, inClient: true }));
      inOrg();
      const body = ["category,value", ...Array.from({ length: 60 }, (_, i) => `City ${i + 1},${i}`)].join("\n") + "\n";
      mockApi({
        [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()),
        [CSV]: () => new Response(body, { status: 200, headers: { "Content-Type": "text/csv" } }),
      });
      try {
        pages("/report/31");
        await userEvent.click(await screen.findByRole("button", { name: "Download CSV of A sales" }));
        const sheet = await screen.findByRole("dialog", { name: "CSV ready" });
        expect(within(within(sheet).getByRole("region", { name: "Preview" })).getAllByRole("row")).toHaveLength(50);
        expect(within(sheet).getByText("Showing the first 50 of 61 rows.")).toBeInTheDocument();
        await userEvent.click(within(sheet).getByRole("button", { name: "Copy CSV" }));
        expect(await screen.findByText(/CSV copied/)).toBeInTheDocument();
        expect(exec).toHaveBeenCalledWith("copy");
        expect(copied).toBe(body);
        expect(writeText).not.toHaveBeenCalled();
        expect(document.querySelector("textarea")).toBeNull();
        expect(within(sheet).getByRole("button", { name: "Copy CSV" })).toHaveFocus();
      } finally {
        Reflect.deleteProperty(navigator, "clipboard");
        Reflect.deleteProperty(document, "execCommand");
      }
    });

    it("says so when neither copy path works, keeping the sheet open (144-05)", async () => {
      Object.defineProperty(navigator, "canShare", { configurable: true, value: () => false });
      Object.defineProperty(navigator, "clipboard", {
        configurable: true, value: { writeText: vi.fn(async () => { throw new DOMException("denied", "NotAllowedError"); }) },
      });
      Object.defineProperty(document, "execCommand", { configurable: true, value: () => false });
      testAuth(fakeLiff({ loggedIn: true, inClient: true }));
      inOrg();
      mockApi({
        [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()),
        [CSV]: () => new Response("category,value\nChiang Mai,1500.5\n", { status: 200 }),
      });
      try {
        pages("/report/31");
        await userEvent.click(await screen.findByRole("button", { name: "Download CSV of A sales" }));
        const sheet = await screen.findByRole("dialog", { name: "CSV ready" });
        await userEvent.click(within(sheet).getByRole("button", { name: "Copy CSV" }));
        expect(await screen.findByText(/could not be copied/)).toBeInTheDocument();
        expect(screen.getByRole("dialog", { name: "CSV ready" })).toBeInTheDocument();
      } finally {
        Reflect.deleteProperty(navigator, "clipboard");
        Reflect.deleteProperty(document, "execCommand");
      }
    });

    it("a cancelled share stays quiet and can be retried, with no browser action (144-03)", async () => {
      share.mockRejectedValueOnce(new DOMException("cancelled", "AbortError"));
      const liff = testAuth(fakeLiff({ loggedIn: true, inClient: true }));
      inOrg();
      const api = mockApi({
        [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()), [CSV]: csvOk,
        [TICKET]: () => json(200, { url: "/api/v1/report-downloads/abc.def" }),
      });
      pages("/report/31");
      await userEvent.click(await screen.findByRole("button", { name: "Download CSV of A sales" }));
      const sheet = await screen.findByRole("dialog", { name: "CSV ready" });
      await userEvent.click(within(sheet).getByRole("button", { name: "Save or share" }));
      await act(async () => {});
      expect(screen.getByRole("dialog", { name: "CSV ready" })).toBeInTheDocument();
      expect(screen.queryByText(/could not|failed/i)).toBeNull();
      await userEvent.click(within(sheet).getByRole("button", { name: "Save or share" }));
      expect(share).toHaveBeenCalledTimes(2);
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(liff.openWindow).not.toHaveBeenCalled();
      expect(api.count(TICKET)).toBe(0);
    });

    it.each(["false", "missing", "throws"])("shares directly when canShare is %s, keeping the user's share-on-tap approach (144-01)", async (probe) => {
      if (probe === "missing") Reflect.deleteProperty(navigator, "canShare");
      else Object.defineProperty(navigator, "canShare", {
        configurable: true, value: () => { if (probe === "throws") throw new Error("probe unsupported"); return false; },
      });
      const liff = testAuth(fakeLiff({ loggedIn: true, inClient: true }));
      inOrg();
      const api = mockApi({ [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()), [CSV]: csvOk });
      pages("/report/31");
      await userEvent.click(await screen.findByRole("button", { name: "Download CSV of A sales" }));
      const sheet = await screen.findByRole("dialog", { name: "CSV ready" });
      expect(share).not.toHaveBeenCalled();
      await userEvent.click(within(sheet).getByRole("button", { name: "Save or share" }));
      expect(share).toHaveBeenCalledTimes(1);
      expect(api.count(TICKET)).toBe(0);
      expect(liff.openWindow).not.toHaveBeenCalled();
    });

    it.each(["missing", "sync-error", "rejected"])("a share failure (%s) stays in LINE and suggests Copy CSV (144-03)", async (failure) => {
      if (failure === "missing") Reflect.deleteProperty(navigator, "share");
      if (failure === "sync-error") share.mockImplementation(() => { throw new TypeError("unsupported file"); });
      if (failure === "rejected") share.mockRejectedValue(new DOMException("blocked", "NotAllowedError"));
      const liff = testAuth(fakeLiff({ loggedIn: true, inClient: true }));
      inOrg();
      const api = mockApi({ [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()), [CSV]: csvOk });
      pages("/report/31");
      await userEvent.click(await screen.findByRole("button", { name: "Download CSV of A sales" }));
      const sheet = await screen.findByRole("dialog", { name: "CSV ready" });
      await userEvent.click(within(sheet).getByRole("button", { name: "Save or share" }));
      expect(await screen.findByText(/Try Copy CSV instead/)).toBeInTheDocument();
      expect(screen.getByRole("dialog", { name: "CSV ready" })).toBeInTheDocument();
      expect(within(sheet).queryByRole("button", { name: "Download in browser" })).toBeNull();
      expect(api.count(TICKET)).toBe(0);
      expect(liff.openWindow).not.toHaveBeenCalled();
    });

    it("a new publication drops the prepared file (144-04)", async () => {
      testAuth(fakeLiff({ loggedIn: true, inClient: true }));
      inOrg();
      const api = mockApi({ [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()), [CSV]: csvOk });
      const { queryClient } = pages("/report/31");
      await userEvent.click(await screen.findByRole("button", { name: "Download CSV of A sales" }));
      await screen.findByRole("dialog", { name: "CSV ready" });
      const nextConfig = { ...CONFIG, cards: [{ ...CONFIG.cards[2], title: "Average sales" }] };
      api.set(ONE, () => json(200, detail({ published: { name: "New overview", version: 3, published_at: T0, config: nextConfig } })));
      api.set(DATA, () => json(200, RESULT({ report_version: 3 })));
      await act(async () => { await queryClient.refetchQueries({ queryKey: ["report", 5, 31], exact: true }); });
      await screen.findByRole("heading", { level: 1, name: "New overview" });
      await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
      expect(share).not.toHaveBeenCalled();
    });
  });

  it("reloads card definitions when refresh returns a newly published snapshot", async () => {
    testAuth();
    inOrg();
    const api = mockApi({ [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()) });
    pages("/report/31");
    await screen.findByText("Bangkok");
    const nextConfig = { ...CONFIG, cards: [{ ...CONFIG.cards[2], title: "Average sales" }] };
    api.set(ONE, () => json(200, detail({ published: { name: "New overview", version: 3, published_at: T0, config: nextConfig } })));
    api.set(DATA, () => json(200, RESULT({ report_version: 3 })));
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    expect(await screen.findByRole("heading", { level: 1, name: "New overview" })).toBeInTheDocument();
    expect(await screen.findByText("Bangkok")).toBeInTheDocument();
    expect(cardTitles()).toEqual(["Average sales"]);
    expect(api.count(ONE)).toBe(2);
  });

  it.each([false, true])("clears old values, sheet and pending CSV when metadata advances first (in LINE: %s)", async (inClient) => {
    const liff = fakeLiff({ loggedIn: true, inClient });
    testAuth(liff);
    inOrg();
    const created = vi.fn(() => "blob:old-version");
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: () => {} });
    let finishData!: (response: Response) => void;
    let finishCsv!: (response: Response) => void;
    const api = mockApi({
      [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()),
      [CSV]: () => new Promise<Response>((resolve) => { finishCsv = resolve; }),
    });
    const { queryClient } = pages("/report/31");
    await screen.findByText("Bangkok");
    await userEvent.click(screen.getByRole("button", { name: "Download CSV of A sales" }));
    await waitFor(() => expect(finishCsv).toBeTypeOf("function"));
    await userEvent.click(screen.getByRole("button", { name: "Details of A sales" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const nextConfig = { ...CONFIG, cards: [{ ...CONFIG.cards[2], title: "Average sales" }] };
    api.set(ONE, () => json(200, detail({ published: { name: "New overview", version: 3, published_at: T0, config: nextConfig } })));
    api.set(DATA, () => new Promise<Response>((resolve) => { finishData = resolve; }));
    await act(async () => { await queryClient.refetchQueries({ queryKey: ["report", 5, 31], exact: true }); });
    // The old sheet can hide the page from accessibility until the version cleanup runs.
    await screen.findByRole("heading", { level: 1, name: "New overview", hidden: true });
    await waitFor(() => expect(finishData).toBeTypeOf("function"));
    expect(screen.queryByText("Bangkok")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => { finishCsv(new Response("category,value\nOld snapshot,100\n", { status: 200 })); });
    expect(created).not.toHaveBeenCalled();
    expect(liff.openWindow).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "CSV ready", hidden: true })).toBeNull();
    await act(async () => { finishData(json(503, { code: "unavailable", message_key: "error.unavailable" })); });
    await screen.findByText("The report data could not be loaded");
    expect(screen.queryByText("Bangkok")).toBeNull();
    expect(screen.queryByText("Refresh failed — the charts show older data")).toBeNull();
    api.set(DATA, () => json(200, RESULT({ report_version: 3 })));
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("Bangkok")).toBeInTheDocument();
  });

  it.each([false, true])("preserves the selected period across metadata changes and ignores old request cleanup (in LINE: %s)", async (inClient) => {
    const liff = fakeLiff({ loggedIn: true, inClient });
    testAuth(liff);
    inOrg();
    const created = vi.fn(() => "blob:new-version");
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: () => {} });
    let finishOldData!: (response: Response) => void;
    let finishOldCsv!: (response: Response) => void;
    let finishNewCsv!: (response: Response) => void;
    const answer = async (r: Request, version = 2) => {
      const body = (await r.json()) as { period: { from: string; to: string } | null };
      return json(200, RESULT({ report_version: version, ...(body.period ? { period: body.period } : {}) }));
    };
    const api = mockApi({ [ONE]: () => json(200, detail()), [DATA]: (r) => answer(r) });
    const { queryClient } = pages("/report/31");
    await screen.findByText("Bangkok");
    await userEvent.type(screen.getByLabelText("From"), "2026-03-01");
    await userEvent.type(screen.getByLabelText("To"), "2026-03-31");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    await screen.findByText("2026-03-01 – 2026-03-31");
    const endpoint = CSV;
    api.set(endpoint, () => new Promise<Response>((resolve) => { finishOldCsv = resolve; }));
    await userEvent.click(screen.getByRole("button", { name: "Download CSV of A sales" }));
    await waitFor(() => expect(finishOldCsv).toBeTypeOf("function"));
    api.set(DATA, () => new Promise<Response>((resolve) => { finishOldData = resolve; }));
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(finishOldData).toBeTypeOf("function"));
    const nextConfig = { ...CONFIG, cards: [{ ...CONFIG.cards[2], title: "Average sales" }] };
    api.set(ONE, () => json(200, detail({ published: { name: "New overview", version: 3, published_at: T0, config: nextConfig } })));
    api.set(DATA, (r) => answer(r, 3));
    await act(async () => { await queryClient.refetchQueries({ queryKey: ["report", 5, 31], exact: true }); });
    await screen.findByRole("heading", { level: 1, name: "New overview" });
    await screen.findByText("Bangkok");
    expect((await api.bodies(DATA)).at(-1)).toEqual({ period: { from: "2026-03-01", to: "2026-03-31" }, refresh: false });
    expect(screen.getByLabelText("From")).toHaveValue("2026-03-01");
    expect(screen.getByLabelText("To")).toHaveValue("2026-03-31");
    const csv = screen.getByRole("button", { name: "Download CSV of Average sales" });
    await waitFor(() => expect(csv).toBeEnabled());
    api.set(endpoint, () => new Promise<Response>((resolve) => { finishNewCsv = resolve; }));
    await userEvent.click(csv);
    await waitFor(() => expect(finishNewCsv).toBeTypeOf("function"));
    await act(async () => {
      finishOldCsv(new Response("category,value\nOld snapshot,100\n", { status: 200 }));
      finishOldData(json(200, RESULT()));
    });
    expect(created).not.toHaveBeenCalled();
    expect(liff.openWindow).not.toHaveBeenCalled();
    expect(screen.queryByRole("dialog", { name: "CSV ready" })).toBeNull();
    expect(csv).toBeDisabled();
    expect(screen.getByText("2026-03-01 – 2026-03-31")).toBeInTheDocument();
    await act(async () => { finishNewCsv(new Response("category,value\nNew snapshot,200\n", { status: 200 })); });
    await waitFor(() => expect(csv).toBeEnabled());
    if (inClient) {
      const sheet = await screen.findByRole("dialog", { name: "CSV ready" });
      expect(within(sheet).getByText("New snapshot")).toBeInTheDocument();
      expect(within(sheet).queryByText("Old snapshot")).toBeNull();
      expect(liff.openWindow).not.toHaveBeenCalled();
    } else expect(created).toHaveBeenCalledTimes(1);
  });

  it.each([false, true])("pins CSV to the displayed actual period even when the default year has changed (in LINE: %s)", async (inClient) => {
    testAuth(fakeLiff({ loggedIn: true, inClient }));
    inOrg();
    const displayed = { from: "2025-01-01", to: "2025-12-31" };
    const api = mockApi({
      [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT({ period: displayed })),
      [CSV]: () => json(409, { code: "report_export_failed", message_key: "error.report_export_failed" }),
    });
    pages("/report/31");
    await screen.findByText("Bangkok");
    await userEvent.click(screen.getByRole("button", { name: "Download CSV of A sales" }));
    await waitFor(() => expect(api.count(CSV)).toBe(1));
    const url = new URL(api.calls.find((c) => c.url.includes("/csv"))!.url);
    expect(url.searchParams.get("from")).toBe(displayed.from);
    expect(url.searchParams.get("to")).toBe(displayed.to);
    expect(url.searchParams.get("report_version")).toBe("2");
    expect(api.count(TICKET)).toBe(0);
    expect((await api.bodies(DATA))[0]).toEqual({ period: null, refresh: false });
  });

  it.each([false, true])("pins CSV to the screen version and reloads after a publication conflict (in LINE: %s)", async (inClient) => {
    const liff = fakeLiff({ loggedIn: true, inClient });
    testAuth(liff);
    inOrg();
    const created = vi.fn(() => "blob:wrong-version");
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: () => {} });
    let requestedVersion: unknown = null;
    const api = mockApi({
      [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()),
      [CSV]: async (r) => {
        requestedVersion = new URL(r.url).searchParams.get("report_version");
        return json(409, { code: "revision_conflict", message_key: "error.revision_conflict" });
      },
    });
    pages("/report/31");
    await screen.findByText("Bangkok");
    api.set(ONE, () => json(200, detail({ published: { ...detail().published!, name: "New published overview", version: 3 } })));
    api.set(DATA, () => json(200, RESULT({ report_version: 3 })));
    await userEvent.click(screen.getByRole("button", { name: "Download CSV of A sales" }));
    await waitFor(() => expect(api.count(CSV)).toBe(1));
    expect(requestedVersion).toBe("2");
    expect(await screen.findByRole("heading", { name: "New published overview" })).toBeInTheDocument();
    expect(created).not.toHaveBeenCalled();
    expect(liff.openWindow).not.toHaveBeenCalled();
  });

  it.each([401, 403, 404, 409])("clears values and an open sheet after a CSV access refusal (%s)", async (status) => {
    testAuth(fakeLiff({ loggedIn: true, inClient: false }));
    inOrg();
    let refuse!: (response: Response) => void;
    const api = mockApi({
      [ONE]: () => json(200, detail()),
      [DATA]: () => json(200, RESULT()),
      [CSV]: () => new Promise<Response>((resolve) => { refuse = resolve; }),
    });
    pages("/report/31");
    await screen.findByText("Bangkok");
    await userEvent.click(screen.getByRole("button", { name: "Download CSV of A sales" }));
    await waitFor(() => expect(refuse).toBeTypeOf("function"));
    await userEvent.click(screen.getByRole("button", { name: "Details of A sales" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    const code = status === 409 ? "report_not_published" : "permission_denied";
    const denial = () => json(status, { code, message_key: `error.${code}` });
    api.set(ONE, denial);
    api.set(DATA, denial);
    await act(async () => { refuse(denial()); });
    await waitFor(() => expect(screen.queryByText("Bangkok")).toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  it("preserves viewing after rechecking export-only revocation", async () => {
    testAuth(fakeLiff({ loggedIn: true, inClient: false }));
    inOrg();
    const api = mockApi({ [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()) });
    pages("/report/31");
    await screen.findByText("Bangkok");
    api.set(ONE, () => json(200, detail({ can_export: false })));
    api.set(CSV, () => json(403, { code: "permission_denied", message_key: "error.permission_denied" }));
    await userEvent.click(screen.getByRole("button", { name: "Download CSV of A sales" }));
    await waitFor(() => expect(screen.queryByRole("button", { name: "Download CSV of A sales" })).toBeNull());
    expect(await screen.findByText("Bangkok")).toBeInTheDocument();
  });

  it("rechecks export-only revocation using the currently selected period", async () => {
    testAuth(fakeLiff({ loggedIn: true, inClient: false }));
    inOrg();
    let finishCsv!: (response: Response) => void;
    const api = mockApi({
      [ONE]: () => json(200, detail()),
      [DATA]: async (r) => {
        const body = (await r.json()) as { period: { from: string; to: string } | null };
        return json(200, RESULT(body.period ? { period: body.period } : {}));
      },
      [CSV]: () => new Promise<Response>((resolve) => { finishCsv = resolve; }),
    });
    pages("/report/31");
    await screen.findByText("Bangkok");
    await userEvent.click(screen.getByRole("button", { name: "Download CSV of A sales" }));
    await waitFor(() => expect(finishCsv).toBeTypeOf("function"));
    await userEvent.type(screen.getByLabelText("From"), "2026-03-01");
    await userEvent.type(screen.getByLabelText("To"), "2026-03-31");
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    await screen.findByText("2026-03-01 – 2026-03-31");
    api.set(ONE, () => json(200, detail({ can_export: false })));
    await act(async () => { finishCsv(json(403, { code: "permission_denied", message_key: "error.permission_denied" })); });
    await waitFor(() => expect(api.count(DATA)).toBe(3));
    expect((await api.bodies(DATA)).at(-1)).toEqual({ period: { from: "2026-03-01", to: "2026-03-31" }, refresh: true });
    expect(await screen.findByText("2026-03-01 – 2026-03-31")).toBeInTheDocument();
    expect(await screen.findByText("Bangkok")).toBeInTheDocument();
  });

  it("honours a pending CSV denial even after an overlapping refresh starts", async () => {
    testAuth(fakeLiff({ loggedIn: true, inClient: false }));
    inOrg();
    let finishCsv!: (response: Response) => void;
    let finishRefresh!: (response: Response) => void;
    const api = mockApi({
      [ONE]: () => json(200, detail()),
      [DATA]: () => json(200, RESULT()),
      [CSV]: () => new Promise<Response>((resolve) => { finishCsv = resolve; }),
    });
    pages("/report/31");
    await screen.findByText("Bangkok");
    await userEvent.click(screen.getByRole("button", { name: "Download CSV of A sales" }));
    await waitFor(() => expect(finishCsv).toBeTypeOf("function"));
    api.set(DATA, () => new Promise<Response>((resolve) => { finishRefresh = resolve; }));
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(finishRefresh).toBeTypeOf("function"));
    await userEvent.click(screen.getByRole("button", { name: "Details of A sales" }));
    const denial = () => json(403, { code: "permission_denied", message_key: "error.permission_denied" });
    api.set(ONE, denial);
    api.set(DATA, denial);
    await act(async () => { finishCsv(denial()); });
    await waitFor(() => expect(screen.queryByText("Bangkok")).toBeNull());
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => { finishRefresh(json(200, RESULT())); });
    expect(screen.queryByText("Bangkok")).toBeNull();
  });

  it.each([false, true])("does not deliver a pending CSV or ticket after refresh reports unpublication (in LINE: %s)", async (inClient) => {
    const liff = fakeLiff({ loggedIn: true, inClient });
    testAuth(liff);
    inOrg();
    const created = vi.fn(() => "blob:unpublished");
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: () => {} });
    let finishCsv!: (response: Response) => void;
    let finishRefresh!: (response: Response) => void;
    const api = mockApi({
      [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()),
      [CSV]: () => new Promise<Response>((resolve) => { finishCsv = resolve; }),
    });
    pages("/report/31");
    await screen.findByText("Bangkok");
    await userEvent.click(screen.getByRole("button", { name: "Download CSV of A sales" }));
    await waitFor(() => expect(finishCsv).toBeTypeOf("function"));
    api.set(DATA, () => new Promise<Response>((resolve) => { finishRefresh = resolve; }));
    await userEvent.click(screen.getByRole("button", { name: "Refresh" }));
    await waitFor(() => expect(finishRefresh).toBeTypeOf("function"));
    await userEvent.click(screen.getByRole("button", { name: "Details of A sales" }));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await act(async () => { finishRefresh(json(409, { code: "report_not_published", message_key: "error.report_not_published" })); });
    expect(await screen.findByText("This report was unpublished meanwhile.")).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).toBeNull();
    await act(async () => { finishCsv(new Response("category,value\nOld publication,100\n", { status: 200 })); });
    expect(created).not.toHaveBeenCalled();
    expect(liff.openWindow).not.toHaveBeenCalled();
    expect(screen.queryByText("CSV downloaded")).toBeNull();
    expect(screen.queryByRole("dialog", { name: "CSV ready" })).toBeNull();
  });

  it.each([false, true])("does not deliver a late CSV or ticket after a tenant switch (in LINE: %s)", async (inClient) => {
    const liff = fakeLiff({ loggedIn: true, inClient });
    testAuth(liff);
    inOrg(VIEWER, [OTHER]);
    const created = vi.fn(() => "blob:old-tenant");
    Object.assign(URL, { createObjectURL: created, revokeObjectURL: () => {} });
    let finish!: (response: Response) => void;
    mockApi({
      [ONE]: (r) => r.headers.get("X-Tenant-Id") === "5"
        ? json(200, detail()) : json(404, { code: "not_found", message_key: "error.not_found" }),
      [DATA]: () => json(200, RESULT()),
      [CSV]: () => new Promise<Response>((resolve) => { finish = resolve; }),
    });
    pages("/report/31");
    await screen.findByText("Bangkok");
    await userEvent.click(screen.getByRole("button", { name: "Download CSV of A sales" }));
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    act(() => useTenantChoice.getState().choose(OTHER.tenant_id));
    await screen.findByText("This report does not exist or is not in the current account.");
    await act(async () => { finish(new Response("category,value\nOld tenant,100\n", { status: 200, headers: { "Content-Type": "text/csv" } })); });
    expect(created).not.toHaveBeenCalled();
    expect(liff.openWindow).not.toHaveBeenCalled();
    expect(screen.queryByText("CSV downloaded")).toBeNull();
    expect(screen.queryByRole("dialog", { name: "CSV ready" })).toBeNull();
  });

  it("without export there is no CSV; details open in a sheet", async () => {
    testAuth();
    inOrg(NO_EXPORT);
    mockApi({ [ONE]: () => json(200, detail({ can_export: false })), [DATA]: () => json(200, RESULT()) });
    pages("/report/31");
    expect(await screen.findByText("Bangkok")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Download CSV/ })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Details of A sales" }));
    const sheet = await screen.findByRole("dialog", { name: "Details of A sales" });
    expect(within(sheet).getByText(/Invoice/)).toBeInTheDocument();
    await userEvent.click(within(sheet).getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });

  it("says when the report was unpublished, is not published or does not exist", async () => {
    testAuth();
    inOrg();
    const api = mockApi({
      [ONE]: () => json(200, detail()),
      [DATA]: () => json(409, { code: "report_not_published", message_key: "x" }),
    });
    const first = pages("/report/31");
    expect(await screen.findByText("This report was unpublished meanwhile.")).toBeInTheDocument();
    first.unmount();
    api.set(ONE, () => json(200, detail({ published: null, status: "draft" })));
    const second = pages("/report/31");
    expect(await screen.findByText("This report is not published yet.")).toBeInTheDocument();
    second.unmount();
    api.set(ONE, () => json(404, { code: "not_found", message_key: "error.not_found" }));
    pages("/report/31");
    expect(await screen.findByText("This report does not exist or is not in the current account.")).toBeInTheDocument();
  });

  it("a report without cards says so", async () => {
    testAuth();
    inOrg();
    mockApi({
      [ONE]: () => json(200, detail({ published: { ...detail().published!, config: { ...CONFIG, cards: [] } } })),
      [DATA]: () => json(200, RESULT({ cards: [] })),
    });
    pages("/report/31");
    expect(await screen.findByText("This report has no charts.")).toBeInTheDocument();
  });

  it("a tenant switch clears the old statistics and asks the new tenant (056-06)", async () => {
    testAuth();
    inOrg(VIEWER, [OTHER]);
    const api = mockApi({
      [ONE]: (r) =>
        r.headers.get("X-Tenant-Id") === "5"
          ? json(200, detail())
          : json(404, { code: "not_found", message_key: "error.not_found" }),
      [DATA]: () => json(200, RESULT()),
    });
    pages("/report/31");
    expect(await screen.findByText("Bangkok")).toBeInTheDocument();
    act(() => useTenantChoice.getState().choose(OTHER.tenant_id));
    expect(await screen.findByText("This report does not exist or is not in the current account.")).toBeInTheDocument();
    expect(screen.queryByText("Bangkok")).toBeNull();
    expect(api.calls.filter((c) => c.method === "GET").map((c) => c.headers.get("X-Tenant-Id"))).toEqual(["5", "6"]);
  });

  it("renders in Thai with the shared texts", async () => {
    testAuth();
    inOrg();
    useLanguage.getState().setLang("th");
    mockApi({ [ONE]: () => json(200, detail()), [DATA]: () => json(200, RESULT()) });
    pages("/report/31");
    expect(await screen.findByText("Bangkok")).toBeInTheDocument();
    expect(screen.queryByText("Refresh")).toBeNull();
    expect(screen.queryByText("Only documents you submitted")).toBeNull();
  });
});

describe("Report tab and route (FR-SYS-056)", () => {
  const USAGE = {
    active: true,
    plan: { code: "starter", period: "month", starts_at: T0, ends_at: "2026-12-10T03:00:00Z" },
    month: { month: "2026-11-01", quota: 5000, used: 0, remaining: 5000 },
    free: { remaining: 0, expires_at: null, paused: false },
  };

  function boot(tenant: UsableTenant, route: string, usage: unknown = USAGE) {
    localStorage.setItem("saiflow.tenant", String(tenant.tenant_id));
    useTenantChoice.getState().choose(tenant.tenant_id);
    const api = mockApi({
      "GET /api/v1/me": () => json(200, USER),
      "GET /api/v1/me/tenants": () => json(200, [PERSONAL, tenant]),
      "GET /api/v1/billing/usage": () => json(200, usage),
      "GET /api/v1/me/notifications": () => json(200, { items: [], next_cursor: null, unread_count: 0 }),
      "GET /api/v1/reports": () => json(200, { items: [summary()] }),
      [ONE]: () => json(200, detail()),
      [DATA]: () => json(200, RESULT()),
    });
    renderWithProviders(<Shell liff={fakeLiff()} search="" liffTimeoutMs={50} />, { route });
    return api;
  }

  it("Starter organization with report_view: four tabs, the list instead of coming soon (056-02)", async () => {
    boot(VIEWER, "/");
    const nav = await screen.findByRole("navigation");
    await waitFor(() =>
      expect(within(nav).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Home", "History", "Report", "My"]),
    );
    await userEvent.click(within(nav).getByRole("tab", { name: "Report" }));
    expect(await screen.findByRole("list", { name: "Published reports" })).toBeInTheDocument();
    expect(screen.queryByText("Coming soon")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: /Sales overview/ }));
    expect(await screen.findByText("Bangkok")).toBeInTheDocument();
    // a report page is not a tab page
    expect(screen.queryByRole("navigation")).toBeNull();
  });

  it("a report link without report_view leads home (056-03)", async () => {
    const api = boot({ ...ORG, permissions: ["upload_ocr"] }, "/report/31");
    const nav = await screen.findByRole("navigation");
    expect(within(nav).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Home", "History", "My"]);
    expect(within(nav).getByRole("tab", { name: "Home" })).toHaveAttribute("aria-selected", "true");
    expect(api.count(ONE)).toBe(0);
  });

  it("an expired plan hides the tab and the report pages (056-03)", async () => {
    const api = boot(VIEWER, "/report/31", { ...USAGE, active: false });
    const nav = await screen.findByRole("navigation");
    expect(within(nav).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Home", "History", "My"]);
    expect(api.count(DATA)).toBe(0);
  });
});
