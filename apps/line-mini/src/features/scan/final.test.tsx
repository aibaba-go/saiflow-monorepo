import { screen, waitFor } from "@testing-library/react";
import userEventLib from "@testing-library/user-event";
import { act } from "react";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
    });

  const stubShare = (canShare: boolean, share = vi.fn<(data: ShareData) => Promise<void>>(async () => {})) => {
    Object.defineProperty(navigator, "canShare", { configurable: true, value: () => canShare });
    Object.defineProperty(navigator, "share", { configurable: true, value: share });
    return share;
  };
  afterEach(() => {
    Reflect.deleteProperty(navigator, "canShare");
    Reflect.deleteProperty(navigator, "share");
  });

  it("export in LINE prepares a file and shares it from a tap (107-01)", async () => {
    const liff = testAuth(fakeLiff({ loggedIn: true, inClient: true }));
    const share = stubShare(true);
    const api = finalApi();
    useLanguage.getState().setLang("th");
    signedIn(USER, [PERSONAL]);
    pages("/scan/jobs/j1/final");
    expect(await screen.findByText("IV1")).toBeInTheDocument(); // read only
    expect(screen.queryByRole("textbox")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "ส่งออก Excel" }));
    await userEvent.click(await screen.findByRole("button", { name: "แชร์ Excel" }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    const file = share.mock.calls[0]![0].files![0]!;
    expect(file.name).toBe("invoice.xlsx");
    expect(await file.text()).toBe("xlsx-bytes");
    // stays inside LINE: no ticket, no external browser
    expect(liff.openWindow).not.toHaveBeenCalled();
    expect(await api.bodies("POST /api/v1/exports/e1/ticket")).toEqual([]);
    expect(await api.bodies(`POST ${JOB}/exports`)).toEqual([{ language: "th" }]);
  });

  it.each(["false", "missing", "throws"])("shares directly without trusting canShare (%s), never offering the browser (107-06)", async (probe) => {
    const liff = testAuth(fakeLiff({ loggedIn: true, inClient: true }));
    const share = stubShare(false);
    if (probe === "missing") Reflect.deleteProperty(navigator, "canShare");
    if (probe === "throws") Object.defineProperty(navigator, "canShare", { configurable: true, value: () => { throw new Error("unsupported probe"); } });
    const api = finalApi();
    signedIn(USER, [PERSONAL]);
    pages("/scan/jobs/j1/final");
    await userEvent.click(await screen.findByRole("button", { name: "Export Excel" }));
    const button = await screen.findByRole("button", { name: "Share Excel" });
    expect(share).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Download in browser" })).toBeNull();
    await userEvent.click(button);
    expect(share).toHaveBeenCalledTimes(1);
    expect(liff.openWindow).not.toHaveBeenCalled();
    expect(api.count("POST /api/v1/exports/e1/ticket")).toBe(0);
  });

  it("missing share API is explained in the page without an external fallback (107-06)", async () => {
    const liff = testAuth(fakeLiff({ loggedIn: true, inClient: true }));
    Reflect.deleteProperty(navigator, "share");
    const api = finalApi();
    signedIn(USER, [PERSONAL]);
    pages("/scan/jobs/j1/final");
    await userEvent.click(await screen.findByRole("button", { name: "Export Excel" }));
    await userEvent.click(await screen.findByRole("button", { name: "Share Excel" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("does not provide file sharing");
    expect(screen.getByRole("button", { name: "Share Excel" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download in browser" })).toBeNull();
    expect(liff.openWindow).not.toHaveBeenCalled();
    expect(api.count("POST /api/v1/exports/e1/ticket")).toBe(0);
  });

  it("a cancelled share stays quiet; a failed share stays in the page for retry (107-07)", async () => {
    const liff = testAuth(fakeLiff({ loggedIn: true, inClient: true }));
    const share = stubShare(true, vi.fn<(data: ShareData) => Promise<void>>(async () => {
      throw new DOMException("cancelled", "AbortError");
    }));
    finalApi();
    signedIn(USER, [PERSONAL]);
    pages("/scan/jobs/j1/final");
    await userEvent.click(await screen.findByRole("button", { name: "Export Excel" }));
    await userEvent.click(await screen.findByRole("button", { name: "Share Excel" }));
    await waitFor(() => expect(share).toHaveBeenCalledTimes(1));
    expect(screen.queryByRole("alert")).toBeNull();
    share.mockImplementation(async () => {
      throw new DOMException("blocked", "NotAllowedError");
    });
    await userEvent.click(screen.getByRole("button", { name: "Share Excel" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("try sharing again");
    expect(screen.getByRole("button", { name: "Share Excel" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Download in browser" })).toBeNull();
    expect(liff.openWindow).not.toHaveBeenCalled();
    share.mockResolvedValueOnce();
    await userEvent.click(screen.getByRole("button", { name: "Share Excel" }));
    await waitFor(() => expect(screen.queryByRole("region", { name: "Excel export ready" })).toBeNull());
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
