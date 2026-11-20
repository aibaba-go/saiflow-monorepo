import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEventLib from "@testing-library/user-event";
import { act } from "react";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Shell } from "../../App";
import { apiBaseUrl } from "../../config";
import { setUnauthenticatedHandler } from "../../services/api";
import { useLanguage } from "../../stores/language";
import { testAuth } from "../../test/auth";
import { fakeLiff } from "../../test/fakeLiff";
import { GUEST, ORG, PERSONAL, signedIn, UNREGISTERED, USER } from "../../test/fixtures";
import { json, mockApi } from "../../test/mockApi";
import { useSession } from "../../stores/session";
import { renderWithProviders } from "../../test/render";
import { useTenantChoice } from "../tenants/useCurrentTenant";
import { FinalResultPage } from "./FinalResultPage";
import { ResultPage } from "./ResultPage";
import { confirmResult } from "./confirm";

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
    // a guest gets the login panel (FR-SYS-153), returning to this result page
    testAuth(fakeLiff({ loggedIn: false, inClient: false }));
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
    await waitFor(() => expect(useSession.getState().loginOpen).toBe(true));
    expect(useSession.getState().loginReturnTo).toBe("/scan/jobs/j1/result");
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

  it.each([
    ["claims the same guest tenant", GUEST.tenant_id],
    ["merges into another personal tenant", USER.tenant_id],
  ])("new LINE user %s, registers and confirms the saved draft (010, 041-02, 042-01, 106-01)", async (_flow, personalTenantId) => {
    useSession.getState().reset();
    const registeredUser = { ...USER, tenant_id: personalTenantId };
    const unregisteredUser = { ...UNREGISTERED, tenant_id: personalTenantId };
    const personal = { ...PERSONAL, tenant_id: personalTenantId };
    let me = GUEST;
    let stored = result(1, { document: { invoice_no: "IV1", invoice_date: "2026-10-01" } });
    const api = mockApi({
      "GET /api/v1/me": () => json(200, me),
      "GET /api/v1/me/tenants": () => json(200, [personal]),
      "GET /api/v1/billing/usage": () => json(404, { code: "not_found" }),
      "POST /api/v1/auth/line": () => { me = unregisteredUser; return json(200, me); },
      "POST /api/v1/me/registration": () => { me = registeredUser; return json(200, me); },
      [`GET ${JOB}`]: () => json(200, job(stored.confirmed ? "CONFIRMED" : "VERIFYING")),
      [`GET ${JOB}/result`]: () => json(200, stored),
      [`PATCH ${JOB}/result`]: async (r) => {
        const body = (await r.json()) as { structured: unknown; confirm: boolean };
        stored = result(stored.version + 1, body.structured, body.confirm) as typeof stored;
        return json(200, stored);
      },
    });
    renderWithProviders(<Shell liff={fakeLiff({ loggedIn: true })} search="" liffTimeoutMs={50} />, {
      route: "/scan/jobs/j1/result",
    });
    const no = await screen.findByRole("textbox", { name: "Tax Invoice No." });
    await userEvent.clear(no);
    await userEvent.type(no, "IV9");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await userEvent.click(await screen.findByRole("button", { name: "Log in with LINE" }));
    const registration = await screen.findByRole("dialog", { name: "Complete your registration" });
    expect(screen.queryByRole("dialog", { name: "Log in" })).toBeNull();
    expect(screen.queryByText("LINE login failed. Please try again.")).toBeNull();
    expect(useSession.getState().me?.registered).toBe(false);
    expect(await api.bodies(`PATCH ${JOB}/result`)).toEqual([
      { expected_version: 1, structured: { document: { invoice_no: "IV9", invoice_date: "2026-10-01" } }, confirm: false },
    ]); // no final submission until registration is complete
    expect(within(registration).getByLabelText("Email")).toHaveValue("line@example.com");
    await userEvent.type(within(registration).getByLabelText("Verification code"), "123456");
    await userEvent.type(within(registration).getByLabelText("Password"), "abcd1234");
    await userEvent.type(within(registration).getByLabelText("Confirm password"), "abcd1234");
    await userEvent.click(within(registration).getByRole("button", { name: "Register" }));
    // The confirmed result briefly offers a "Final result" button before navigation;
    // wait for the destination's heading, not that transient button.
    expect(await screen.findByRole("heading", { name: "Final result" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(useSession.getState().me?.registered).toBe(true);
    expect(sessionStorage.getItem("saiflow.confirm-after-login.j1")).toBeNull();
    const bodies = (await api.bodies(`PATCH ${JOB}/result`)) as { confirm: boolean; structured: unknown }[];
    expect(bodies).toHaveLength(2);
    expect(bodies[1]).toMatchObject({ confirm: true, structured: { document: { invoice_no: "IV9" } } });
  });

  it.each(["network", "result_confirmed"])("reads back a committed confirmation after %s and enters final without replay (106)", async (failure) => {
    let stored = result(1, { document: { invoice_no: "IV1", invoice_date: "2026-10-01" } });
    const api = mockApi({
      [`GET ${JOB}`]: () => json(200, job(stored.confirmed ? "CONFIRMED" : "VERIFYING")),
      [`GET ${JOB}/result`]: () => json(200, stored),
      [`PATCH ${JOB}/result`]: () => {
        stored = { ...stored, confirmed: true };
        if (failure === "network") throw new TypeError("response lost after commit");
        return json(409, { code: "result_confirmed" });
      },
    });
    signedIn(USER, [PERSONAL]);
    pages("/scan/jobs/j1/result");
    await userEvent.click(await screen.findByRole("button", { name: "Continue" }));
    expect(await screen.findByRole("heading", { name: "Final result" })).toBeInTheDocument();
    expect(api.count(`PATCH ${JOB}/result`)).toBe(1);
    expect(sessionStorage.getItem("saiflow.confirm-after-login.j1")).toBeNull();
  });

  it("confirmation only updates this tenant and job's cache (106, 015)", async () => {
    let stored = result(1, { document: { invoice_no: "IV1", invoice_date: "2026-10-01" } });
    mockApi({
      [`GET ${JOB}`]: () => json(200, job(stored.confirmed ? "CONFIRMED" : "VERIFYING")),
      [`GET ${JOB}/result`]: () => json(200, stored),
      [`PATCH ${JOB}/result`]: () => {
        stored = { ...stored, confirmed: true };
        return json(200, stored);
      },
    });
    signedIn(USER, [PERSONAL]);
    const { queryClient } = pages("/scan/jobs/j1/result");
    const other = result(1, { document: { invoice_no: "OTHER" } });
    queryClient.setQueryData(["result", USER.tenant_id, "j2"], other);
    queryClient.setQueryData(["result", ORG.tenant_id, "j1"], other);
    // Keep the initial result editable so this is a real confirmation.
    queryClient.setQueryData(["result", USER.tenant_id, "j1"], stored);
    await userEvent.click(await screen.findByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Final result" });
    expect(queryClient.getQueryData(["result", USER.tenant_id, "j2"])).toEqual(other);
    expect(queryClient.getQueryData(["result", ORG.tenant_id, "j1"])).toEqual(other);
  });

  it("registration auto-confirm and manual Continue share one in-flight submission (106-01)", async () => {
    signedIn(USER, [PERSONAL]);
    sessionStorage.setItem("saiflow.confirm-after-login.j1", "1");
    let finish!: (response: Response) => void;
    const stored = result(1, { document: { invoice_no: "IV1", invoice_date: "2026-10-01" } });
    const api = mockApi({
      [`GET ${JOB}`]: () => json(200, job("CONFIRMED")),
      [`GET ${JOB}/result`]: () => json(200, stored),
      [`PATCH ${JOB}/result`]: () => new Promise<Response>((resolve) => { finish = resolve; }),
    });
    pages("/scan/jobs/j1/result");
    await waitFor(() => expect(api.count(`PATCH ${JOB}/result`)).toBe(1));
    const button = screen.getByRole("button", { name: "Saving…" });
    expect(button).toBeDisabled();
    await userEvent.click(button);
    expect(api.count(`PATCH ${JOB}/result`)).toBe(1);
    await act(async () => finish(json(200, { ...stored, confirmed: true })));
    await screen.findByRole("heading", { name: "Final result" });
  });

  it("cancels a stale result read before installing the confirmed cache (106, 006)", async () => {
    signedIn(USER, [PERSONAL]);
    const stored = result(1, { document: { invoice_no: "IV1", invoice_date: "2026-10-01" } });
    let finish!: (response: Response) => void;
    let staleSignal!: AbortSignal;
    let reads = 0;
    const api = mockApi({
      [`GET ${JOB}`]: () => json(200, job("CONFIRMED")),
      [`GET ${JOB}/result`]: (request) => {
        reads += 1;
        if (reads === 2) {
          staleSignal = request.signal;
          return new Promise<Response>((resolve) => { finish = resolve; });
        }
        return json(200, reads === 1 ? stored : { ...stored, confirmed: true });
      },
      [`PATCH ${JOB}/result`]: () => json(200, { ...stored, confirmed: true }),
    });
    const { queryClient } = pages("/scan/jobs/j1/result");
    await screen.findByRole("button", { name: "Continue" });
    act(() => { void queryClient.refetchQueries({ queryKey: ["result", USER.tenant_id, "j1"], exact: true }); });
    await waitFor(() => expect(api.count(`GET ${JOB}/result`)).toBe(2));
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await screen.findByRole("heading", { name: "Final result" });
    expect(staleSignal.aborted).toBe(true);
    await act(async () => finish(json(200, stored)));
    expect(queryClient.getQueryData(["result", USER.tenant_id, "j1"])).toMatchObject({ confirmed: true });
  });

  it("does not read back under a different tenant after a late network failure (106)", async () => {
    signedIn(USER, [PERSONAL, ORG]);
    let fail!: (reason: Error) => void;
    const api = mockApi({ [`PATCH ${JOB}/result`]: () => new Promise<Response>((_resolve, reject) => { fail = reject; }) });
    const pending = confirmResult("j1", 1, {});
    await waitFor(() => expect(fail).toBeTypeOf("function"));
    useTenantChoice.getState().choose(ORG.tenant_id);
    fail(new TypeError("late response loss"));
    expect(await pending).toMatchObject({ kind: "error" });
    expect(api.count(`GET ${JOB}/result`)).toBe(0);
  });

  it("resumes registration confirmation after template processing finishes (106-01)", async () => {
    signedIn(USER, [PERSONAL]);
    sessionStorage.setItem("saiflow.confirm-after-login.j1", "1");
    const stored = result(1, { document: { invoice_no: "IV1", invoice_date: "2026-10-01" } });
    const api = mockApi({
      [`GET ${JOB}`]: () => json(200, job("CONFIRMED")),
      [`GET ${JOB}/result`]: () => json(200, { ...stored, mapping: { status: "CONVERTING" } }),
      [`PATCH ${JOB}/result`]: () => json(200, { ...stored, confirmed: true }),
    });
    const { queryClient } = pages("/scan/jobs/j1/result");
    expect(await screen.findByRole("button", { name: "Continue" })).toBeDisabled();
    expect(api.count(`PATCH ${JOB}/result`)).toBe(0);
    act(() => { queryClient.setQueryData(["result", USER.tenant_id, "j1"], stored); });
    await screen.findByRole("heading", { name: "Final result" });
    expect(api.count(`PATCH ${JOB}/result`)).toBe(1);
  });

  it("a late draft cannot overwrite a newer locked result or confirm it (015, 006)", async () => {
    signedIn(USER, [PERSONAL]);
    const structured = { document: { invoice_no: "IV1", invoice_date: "2026-10-01" } };
    let finish!: (response: Response) => void;
    const api = mockApi({
      [`GET ${JOB}`]: () => json(200, job("VERIFYING")),
      [`GET ${JOB}/result`]: () => json(200, result(1, structured)),
      [`PATCH ${JOB}/result`]: () => new Promise<Response>((resolve) => { finish = resolve; }),
    });
    const { queryClient } = pages("/scan/jobs/j1/result");
    await userEvent.type(await screen.findByRole("textbox", { name: "Tax Invoice No." }), "9");
    await userEvent.click(screen.getByRole("button", { name: "Continue" }));
    await waitFor(() => expect(finish).toBeTypeOf("function"));
    const newer = result(3, { document: { invoice_no: "NEWER" } }, true);
    act(() => { queryClient.setQueryData(["result", USER.tenant_id, "j1"], newer); });
    await act(async () => finish(json(200, result(2, structured))));
    expect(queryClient.getQueryData(["result", USER.tenant_id, "j1"])).toEqual(newer);
    expect(api.count(`PATCH ${JOB}/result`)).toBe(1);
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("a stalled draft ends waiting and never submits confirmation (106, 015)", async () => {
    signedIn(USER, [PERSONAL]);
    let signal!: AbortSignal;
    const api = mockApi({
      [`GET ${JOB}`]: () => json(200, job("VERIFYING")),
      [`GET ${JOB}/result`]: () => json(200, result(1, { document: { invoice_no: "IV1" } })),
      [`PATCH ${JOB}/result`]: (request) => { signal = request.signal; return new Promise<Response>(() => {}); },
    });
    pages("/scan/jobs/j1/result");
    await userEvent.type(await screen.findByRole("textbox", { name: "Tax Invoice No." }), "9");
    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole("button", { name: "Continue" }));
      await act(async () => { await vi.advanceTimersByTimeAsync(10_000); });
      expect(screen.getByRole("button", { name: "Continue" })).toBeEnabled();
      expect(screen.getByRole("textbox", { name: "Tax Invoice No." })).toHaveValue("IV19");
      expect(api.count(`PATCH ${JOB}/result`)).toBe(1);
      expect(signal.aborted).toBe(true);
    } finally { vi.useRealTimers(); }
  });

  it("a late 401 never invokes recovery for a different identity (106, 055)", async () => {
    signedIn(USER, [PERSONAL]);
    let finish!: (response: Response) => void;
    mockApi({ [`PATCH ${JOB}/result`]: () => new Promise<Response>((resolve) => { finish = resolve; }) });
    const recover = vi.fn();
    setUnauthenticatedHandler(recover);
    try {
      const pending = confirmResult("j1", 1, {});
      await waitFor(() => expect(finish).toBeTypeOf("function"));
      const another = { ...USER, user_id: 8, tenant_id: 80 };
      signedIn(another, [{ ...PERSONAL, tenant_id: 80 }]);
      finish(json(401, { code: "unauthenticated" }));
      expect(await pending).toMatchObject({ kind: "error" });
      expect(recover).not.toHaveBeenCalled();
      expect(useSession.getState().me).toEqual(another);
    } finally { testAuth(); }
  });

  it("a confirmation with no delivered response has a bounded read-only recovery (106)", async () => {
    vi.useFakeTimers();
    try {
      signedIn(USER, [PERSONAL]);
      let patchSignal: AbortSignal | undefined;
      const api = mockApi({
        [`PATCH ${JOB}/result`]: (request) => {
          patchSignal = request.signal;
          return new Promise<Response>(() => {});
        },
        [`GET ${JOB}/result`]: () => json(200, result(1, {}, true)),
      });
      const finished = vi.fn();
      void confirmResult("j1", 1, {}).then(finished);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(finished).toHaveBeenCalledWith(expect.objectContaining({ kind: "confirmed" }));
      expect(patchSignal?.aborted).toBe(true);
      expect(api.count(`PATCH ${JOB}/result`)).toBe(1);
      expect(api.count(`GET ${JOB}/result`)).toBe(1);
    } finally {
      vi.useRealTimers();
    }
  });

  it("a stalled recovery also stops waiting without claiming success (106)", async () => {
    vi.useFakeTimers();
    try {
      signedIn(USER, [PERSONAL]);
      mockApi({
        [`PATCH ${JOB}/result`]: () => { throw new TypeError("network down"); },
        [`GET ${JOB}/result`]: () => new Promise<Response>(() => {}),
      });
      const finished = vi.fn();
      void confirmResult("j1", 1, {}).then(finished);
      await vi.advanceTimersByTimeAsync(10_000);
      expect(finished).toHaveBeenCalledWith(expect.objectContaining({ kind: "error" }));
    } finally {
      vi.useRealTimers();
    }
  });

  it.each(["version_conflict", "plan_expired", "permission_denied"])("does not reconcile or replay the rejected %s confirmation (009, 015)", async (code) => {
    signedIn(USER, [PERSONAL]);
    const api = mockApi({ [`PATCH ${JOB}/result`]: () => json(code === "plan_expired" ? 402 : 409, { code }) });
    expect(await confirmResult("j1", 1, {})).toMatchObject({ kind: "error", error: { code } });
    expect(api.count(`GET ${JOB}/result`)).toBe(0);
    expect(api.count(`PATCH ${JOB}/result`)).toBe(1);
  });

  it("does not navigate when read-back says the result is still unconfirmed (106)", async () => {
    signedIn(USER, [PERSONAL]);
    const api = mockApi({
      [`PATCH ${JOB}/result`]: () => { throw new TypeError("network down"); },
      [`GET ${JOB}/result`]: () => json(200, result(1, {}, false)),
    });
    expect(await confirmResult("j1", 1, {})).toMatchObject({ kind: "error", error: { code: "network" } });
    expect(api.count(`PATCH ${JOB}/result`)).toBe(1);
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
