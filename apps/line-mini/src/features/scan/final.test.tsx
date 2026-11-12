import { screen, waitFor } from "@testing-library/react";
import userEventLib from "@testing-library/user-event";
import { act } from "react";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { apiBaseUrl } from "../../config";
import { useLanguage } from "../../stores/language";
import { testAuth } from "../../test/auth";
import { fakeLiff } from "../../test/fakeLiff";
import { GUEST, ORG, PERSONAL, signedIn, USER } from "../../test/fixtures";
import { json, mockApi } from "../../test/mockApi";
import { renderWithProviders } from "../../test/render";
import { useTenantChoice } from "../tenants/useCurrentTenant";
import { FinalResultPage } from "./FinalResultPage";
import { ResultPage } from "./ResultPage";

const userEvent = userEventLib.setup({ pointerEventsCheck: 0 });
const JOB = "/api/v1/ocr/jobs/j1";

const job = (stage: string) => ({
  id: "j1",
  file_id: "f1",
  file_name: "invoice.png",
  page_count: 1,
  status: "SUCCEEDED",
  stage,
  error_code: null,
  engine: "textin",
  template_name: "Tax Invoice",
  created_at: "2026-11-06T00:00:00Z",
  confirmed_at: null,
});

const GROUPS = [
  {
    key: "document",
    name: "Document",
    items: [
      { kind: "field", key: "invoice_no", name: "Tax Invoice No.", type: "string", required: true },
      { kind: "field", key: "invoice_date", name: "Date", type: "date", required: true },
    ],
  },
];

const result = (version: number, structured: unknown, confirmed = false) => ({
  version,
  structured,
  template: { template_version_id: 3, name: "Tax Invoice", groups: GROUPS },
  missing_required: [],
  mapping: null,
  confirmed,
});

function pages(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/scan/jobs/:id/result" element={<ResultPage />} />
      <Route path="/scan/jobs/:id/final" element={<FinalResultPage />} />
      <Route path="/plans" element={<div>plans page</div>} />
    </Routes>,
    { route },
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useLanguage.getState().setLang("en");
  useTenantChoice.getState().choose(null);
});

describe("confirm (FR-SYS-106)", () => {
  it("guest confirm after login keeps the edit (106-01)", async () => {
    // outside LINE: a guest is sent to LINE login (inside LINE the page reopens instead)
    const liff = testAuth(fakeLiff({ loggedIn: false, inClient: false }));
    let stored = result(1, { document: { invoice_no: "IV1", invoice_date: "2026-10-01" } });
    const api = mockApi({
      [`GET ${JOB}`]: () => json(200, job("VERIFYING")),
      [`GET ${JOB}/result`]: () => json(200, stored),
      [`PATCH ${JOB}/result`]: async (r) => {
        const body = (await r.json()) as { structured: unknown; confirm: boolean };
        stored = result(stored.version + 1, body.structured, body.confirm) as typeof stored;
        return json(200, stored);
      },
    });
    signedIn(GUEST, []);
    pages("/scan/jobs/j1/result");
    const no = await screen.findByRole("textbox", { name: "Tax Invoice No." });
    await userEvent.clear(no);
    await userEvent.type(no, "IV9");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(liff.login).toHaveBeenCalled()); // sent to LINE login
    const [draft] = (await api.bodies(`PATCH ${JOB}/result`)) as { confirm: boolean; structured: { document: { invoice_no: string } } }[];
    expect(draft!.confirm).toBe(false); // the edit was saved before leaving
    expect(draft!.structured.document.invoice_no).toBe("IV9");
    // back from login and registration: the page confirms by itself
    act(() => signedIn(USER, [PERSONAL]));
    expect(await screen.findByText("Final result")).toBeInTheDocument();
    const bodies = (await api.bodies(`PATCH ${JOB}/result`)) as { confirm: boolean; structured: { document: { invoice_no: string } } }[];
    expect(bodies.at(-1)!.confirm).toBe(true);
    expect(bodies.at(-1)!.structured.document.invoice_no).toBe("IV9");
  });

  it("missing required scrolls and marks (106-02)", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    mockApi({
      [`GET ${JOB}`]: () => json(200, job("VERIFYING")),
      [`GET ${JOB}/result`]: () => json(200, result(1, { document: { invoice_no: "IV1", invoice_date: "" } })),
      [`PATCH ${JOB}/result`]: () =>
        json(422, { code: "required_missing", fields: ["structured.document.invoice_date"] }),
    });
    signedIn(USER, [PERSONAL]);
    pages("/scan/jobs/j1/result");
    await userEvent.click(await screen.findByRole("button", { name: "Continue" }));
    await waitFor(() => {
      const date = document.querySelector('[data-path="document.invoice_date"]') as HTMLElement;
      expect(date.className).toContain("required-missing");
    });
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    expect(scroll.mock.contexts[0]).toBe(document.querySelector('[data-path="document.invoice_date"]'));
    expect(screen.queryByText("This result is confirmed.")).toBeNull();
  });

  it("an expired plan offers the plans page", async () => {
    mockApi({
      [`GET ${JOB}`]: () => json(200, job("VERIFYING")),
      [`GET ${JOB}/result`]: () => json(200, result(1, { document: { invoice_no: "IV1", invoice_date: "x" } })),
      [`PATCH ${JOB}/result`]: () => json(402, { code: "plan_expired" }),
    });
    signedIn(USER, [PERSONAL]);
    pages("/scan/jobs/j1/result");
    await userEvent.click(await screen.findByRole("button", { name: "Continue" }));
    await userEvent.click(await screen.findByRole("button", { name: "Open Plans" }));
    expect(await screen.findByText("plans page")).toBeInTheDocument();
  });
});

describe("final result and export (FR-SYS-107)", () => {
  const finalApi = () =>
    mockApi({
      [`GET ${JOB}`]: () => json(200, job("CONFIRMED")),
      [`GET ${JOB}/result`]: () => json(200, result(2, { document: { invoice_no: "IV1", invoice_date: "2026-10-01" } }, true)),
      [`POST ${JOB}/exports`]: () => json(201, { id: "e1", expires_at: "2026-11-07T00:00:00Z" }),
      "GET /api/v1/exports/e1/download": () => new Response("xlsx-bytes", { status: 200 }),
      "POST /api/v1/exports/e1/ticket": () => json(200, { url: "/api/v1/export-downloads/synthetic.signature" }),
    });

  let links: string[];
  beforeEach(() => {
    links = [];
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(function (this: HTMLAnchorElement) { links.push(this.href); });
  });
  afterEach(() => {
    vi.restoreAllMocks();
    Reflect.deleteProperty(navigator, "canShare");
    Reflect.deleteProperty(navigator, "share");
  });

  it("iOS LINE exports with a real server attachment on the first click (107-01)", async () => {
    const liff = testAuth(fakeLiff({ loggedIn: true, inClient: true, os: "ios" }));
    const api = finalApi();
    useLanguage.getState().setLang("th");
    signedIn(USER, [PERSONAL]);
    pages("/scan/jobs/j1/final");
    expect(await screen.findByText("IV1")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "ส่งออก Excel" }));
    await waitFor(() => expect(links).toEqual([`${apiBaseUrl || window.location.origin}/api/v1/export-downloads/synthetic.signature`]));
    expect(liff.openWindow).not.toHaveBeenCalled();
    expect(api.count("POST /api/v1/exports/e1/ticket")).toBe(1);
    expect(api.count("GET /api/v1/exports/e1/download")).toBe(0);
    expect(await api.bodies(`POST ${JOB}/exports`)).toEqual([{ language: "th" }]);
  });

  it("Android LINE uses the working snapshot's phone-browser download (107-06)", async () => {
    const liff = testAuth(fakeLiff({ loggedIn: true, inClient: true, os: "android" }));
    finalApi();
    signedIn(USER, [PERSONAL]);
    pages("/scan/jobs/j1/final");
    await userEvent.click(await screen.findByRole("button", { name: "Export Excel" }));
    await waitFor(() => expect(liff.openWindow).toHaveBeenCalledWith({ url: `${apiBaseUrl || window.location.origin}/api/v1/export-downloads/synthetic.signature`, external: true }));
    expect(await screen.findByText(/Download opened in your phone browser/)).toBeInTheDocument();
    expect(links).toEqual([]);
  });

  it.each(["missing", "false", "throws"])("exports even when Web Share is unusable (%s)", async (probe) => {
    const share = vi.fn(() => { throw new Error("must not share files"); });
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    if (probe === "missing") Reflect.deleteProperty(navigator, "share");
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => { if (probe === "throws") throw new Error("unsupported probe"); return false; } });
    testAuth(fakeLiff({ loggedIn: true, inClient: true }));
    finalApi();
    signedIn(USER, [PERSONAL]);
    pages("/scan/jobs/j1/final");
    await userEvent.click(await screen.findByRole("button", { name: "Export Excel" }));
    await waitFor(() => expect(links).toHaveLength(1));
    expect(share).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Share Excel" })).toBeNull();
  });

  it("a refused ticket offers retry without delivering an invalid file (107-07)", async () => {
    testAuth(fakeLiff({ loggedIn: true, inClient: true }));
    const api = finalApi();
    api.set("POST /api/v1/exports/e1/ticket", () => json(503, { code: "download_ticket_unavailable" }));
    signedIn(USER, [PERSONAL]);
    pages("/scan/jobs/j1/final");
    await userEvent.click(await screen.findByRole("button", { name: "Export Excel" }));
    await screen.findByRole("alert");
    expect(links).toHaveLength(0);
    api.set("POST /api/v1/exports/e1/ticket", () => json(200, { url: "/api/v1/export-downloads/fresh.signature" }));
    await userEvent.click(screen.getByRole("button", { name: "Export Excel" }));
    await waitFor(() => expect(links).toEqual([`${apiBaseUrl || window.location.origin}/api/v1/export-downloads/fresh.signature`]));
  });

  it("discards a late ticket after switching tenants", async () => {
    const liff = testAuth(fakeLiff({ loggedIn: true, inClient: true }));
    let finish!: (response: Response) => void;
    const api = finalApi();
    api.set("POST /api/v1/exports/e1/ticket", () => new Promise<Response>((resolve) => { finish = resolve; }));
    signedIn(USER, [PERSONAL, ORG]);
    pages("/scan/jobs/j1/final");
    await userEvent.click(await screen.findByRole("button", { name: "Export Excel" }));
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    act(() => useTenantChoice.getState().choose(ORG.tenant_id));
    await act(async () => { finish(json(200, { url: "/api/v1/export-downloads/old.signature" })); });
    expect(links).toHaveLength(0);
    expect(liff.openWindow).not.toHaveBeenCalled();
  });

  it("no export permission hides button (107-02)", async () => {
    testAuth();
    finalApi();
    signedIn(USER, [PERSONAL, { ...ORG, permissions: ["upload_ocr", "verify_own"] }]);
    useTenantChoice.getState().choose(ORG.tenant_id);
    pages("/scan/jobs/j1/final");
    expect(await screen.findByText("IV1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export Excel" })).toBeNull();
  });

  it("export states and new scan (116)", async () => {
    testAuth(fakeLiff({ loggedIn: true, inClient: false }));
    const api = finalApi();
    api.set("GET /api/v1/exports/e1/download", () => new Response(new Blob(["xlsx"]), { status: 200 }));
    Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
    signedIn(USER, [PERSONAL]);
    renderWithProviders(
      <Routes>
        <Route path="/scan/jobs/:id/final" element={<FinalResultPage />} />
        <Route path="/" element={<div>home page</div>} />
      </Routes>,
      { route: "/scan/jobs/j1/final" },
    );
    await userEvent.click(await screen.findByRole("button", { name: "Export Excel" }));
    expect(await screen.findByText("Excel export ready")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "New scan" }));
    expect(await screen.findByText("home page")).toBeInTheDocument();
  });

  it.each([
    ["PENDING_REVIEW", "PENDING_L1"],
    ["PENDING_REVIEW", "PENDING_L2"],
    ["CONFIRMED", "CONFIRMED"],
  ])("shows the confirmed version's extra fields read-only (107-04: %s %s)", async (stage, review) => {
    testAuth(fakeLiff({ loggedIn: true, inClient: false }));
    const structured = { document: { invoice_no: "IV1", invoice_date: "2026-10-01", Remark: "Pay next week" } };
    const api = mockApi({
      [`GET ${JOB}`]: () => json(200, job(stage)),
      [`GET ${JOB}/result`]: () =>
        json(200, { ...result(2, structured, true), review: { stage: review, required_level: null, records: [], last_return: null } }),
      [`POST ${JOB}/exports`]: () => json(201, { id: "e1", expires_at: "2026-11-07T00:00:00Z" }),
      "GET /api/v1/exports/e1/download": () => new Response(new Blob(["xlsx"]), { status: 200 }),
    });
    Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => {} });
    signedIn(USER, [PERSONAL]);
    pages("/scan/jobs/j1/final");
    expect(await screen.findByLabelText("Remark")).toHaveTextContent("Pay next week");
    const paths = [...document.querySelectorAll("dl [data-path]")].map((el) => el.getAttribute("data-path"));
    expect(paths).toEqual(["document.invoice_no", "document.invoice_date", "document.Remark"]);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /Add field|Delete field|Add row/ })).toBeNull();
    // the page shows Remark, but exports keep the existing request (107-05: no new scope)
    if (stage === "CONFIRMED") {
      await userEvent.click(screen.getByRole("button", { name: "Export Excel" }));
      await waitFor(() => expect(api.count(`POST ${JOB}/exports`)).toBe(1));
      expect(await api.bodies(`POST ${JOB}/exports`)).toEqual([{ language: "en" }]);
    } else {
      expect(screen.queryByRole("button", { name: "Export Excel" })).toBeNull();
    }
    expect(api.calls.filter((c) => c.method === "PATCH")).toHaveLength(0);
  });
});
