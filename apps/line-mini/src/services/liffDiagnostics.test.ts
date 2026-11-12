import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { fakeLiff } from "../test/fakeLiff";
import { json, mockApi } from "../test/mockApi";
import { downloadCsv } from "../features/reports/api";
import { exportAndDownload } from "../features/scan/download";
import { initWithTimeout, realLiff } from "./liff";
import { serverAttachmentBranch, registerLiffDiagnostics } from "./liffDiagnostics";

const LIFF_ID = "2012285576-KbzpK5mY";
const HEADER = "X-SaiFlow-Liff";

function registered(options: Parameters<typeof fakeLiff>[0] = {}) {
  const liff = fakeLiff(options);
  registerLiffDiagnostics(liff, LIFF_ID, "real");
  return liff;
}

function apiMock() {
  return mockApi({
    "GET /api/v1/health": () => json(200, { status: "ok", database: "ok", version: "test" }),
    "POST /api/v1/ocr/jobs/private-job/exports": () => json(201, { id: "private-export" }),
    "POST /api/v1/exports/private-export/ticket": () => json(200, { url: "/api/v1/export-downloads/private-ticket" }),
    "GET /api/v1/exports/private-export/download": () => new Response("private-document"),
    "GET /api/v1/reports/1/csv": () => new Response("name\nprivate-document\n"),
    "POST /api/v1/reports/1/csv/ticket": () => json(200, { url: "/api/v1/report-downloads/private-ticket" }),
  });
}

function observations(m: ReturnType<typeof mockApi>) {
  return m.calls.filter((r) => r.headers.has(HEADER)).map((r) => JSON.parse(r.headers.get(HEADER)!));
}

beforeEach(() => {
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  Object.defineProperty(URL, "createObjectURL", { configurable: true, value: vi.fn(() => "blob:private-ticket") });
  Object.defineProperty(URL, "revokeObjectURL", { configurable: true, value: vi.fn() });
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  window.history.replaceState({}, "", "/");
});

describe("LIFF diagnostics (FR-SYS-040/107, FR-REPORT-016, FR-PLAT-002/003)", () => {
  it("logs ready and the LINE attachment decision, without sensitive URL, UA, or identity data", async () => {
    const m = apiMock();
    window.history.replaceState({}, "", "/scan/jobs/private-job/final?invite=private-invite&code=private-code");
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue("iPhone Line/15.0 private-ua");
    const liff = registered({ inClient: false, loggedIn: true });
    const token = vi.spyOn(liff, "getIDToken");
    await initWithTimeout(liff, 20_000);
    const decision = vi.spyOn(liff, "isInClient");
    expect(serverAttachmentBranch(liff, "xlsx")).toBe(true);
    expect(decision).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(observations(m)).toHaveLength(2));
    const values = observations(m);
    expect(values).toHaveLength(2);
    expect(values[0]).toMatchObject({ event: "init", init: "ready", branch: "none" });
    expect(values[1]).toMatchObject({ event: "xlsx_branch", in_client: false, branch: "ticket", os: "ios", ua_line: true, ua_os: "ios", page: "final", liff_id: LIFF_ID });
    expect(values[0].trace).toBe(values[1].trace);
    expect(values[0].trace).toMatch(/^[a-f0-9]{32}$/);
    expect(JSON.stringify(values)).not.toMatch(/private-|id-token/);
    expect(token).not.toHaveBeenCalled();
    expect(console.info).toHaveBeenCalledWith("[SaiFlow LIFF]", values[1]);
    for (const request of m.calls) {
      expect(new URL(request.url).pathname).toBe("/api/v1/health");
      expect(new URL(request.url).search).toBe("");
      expect(request.credentials).toBe("omit");
      expect(request.keepalive).toBe(true);
      expect(request.headers.get("Cookie")).toBeNull();
      expect(request.headers.get("X-Tenant-Id")).toBeNull();
    }
  });

  it.each([
    ["/#/", "home"],
    ["/?invite=private-invite#/scan/jobs/private-job/final?code=private-code", "final"],
    ["/#/report/private-report?period=private-period", "report"],
  ])("categorizes actual HashRouter route %s without leaking hash/query", async (route, page) => {
    const m = apiMock();
    window.history.replaceState({}, "", route!);
    serverAttachmentBranch(registered({ inClient: false }), "csv");
    await vi.waitFor(() => expect(observations(m)).toHaveLength(1));
    expect(observations(m)[0].page).toBe(page);
    expect(JSON.stringify(observations(m))).not.toContain("private-");
  });

  const PC = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) Chrome/130.0 Safari/537.36";
  const SAFARI = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Version/18.0 Mobile/15E148 Safari/604.1";
  const IOS_LINE = "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Mobile/15E148 Safari Line/15.0.0";
  const ANDROID_LINE = "Mozilla/5.0 (Linux; Android 14) Chrome/130.0 Mobile Safari/537.36 Line/15.0.0";
  it.each([
    ["LIFF client on PC UA", true, PC, true],
    ["iPhone LINE browser with isInClient=false (observed in production)", false, IOS_LINE, true],
    ["Android LINE browser with isInClient=false", false, ANDROID_LINE, true],
    ["PC browser", false, PC, false],
    ["iPhone Safari outside LINE", false, SAFARI, false],
  ])("%s: Excel and CSV use server attachments only inside LINE", async (_name, inClient, ua, attachment) => {
    const m = apiMock();
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
    const liff = registered({ inClient, loggedIn: true });
    const excel = await exportAndDownload("private-job", "en", liff, "private-name.xlsx");
    const csv = await downloadCsv(liff, 1, "private-card", null, 2);
    expect(excel.how).toBe("saved");
    expect(csv.how).toBe(attachment ? "prepared" : "saved");
    expect(m.count("POST /api/v1/exports/private-export/ticket")).toBe(attachment ? 1 : 0);
    expect(m.count("GET /api/v1/exports/private-export/download")).toBe(attachment ? 0 : 1);
    expect(m.count("POST /api/v1/reports/1/csv/ticket")).toBe(attachment ? 1 : 0);
    expect(URL.createObjectURL).toHaveBeenCalledTimes(attachment ? 0 : 2);
    const clicked = vi.mocked(HTMLAnchorElement.prototype.click).mock.contexts
      .map((link) => (link as HTMLAnchorElement).href);
    expect(clicked).toEqual(attachment
      ? ["http://localhost/api/v1/export-downloads/private-ticket", "http://localhost/api/v1/report-downloads/private-ticket"]
      : ["blob:private-ticket", "blob:private-ticket"]);
    await vi.waitFor(() => expect(observations(m)).toHaveLength(2));
    expect(observations(m).map((v) => [v.event, v.in_client, v.branch])).toEqual([
      ["xlsx_branch", inClient, attachment ? "ticket" : "blob"],
      ["csv_branch", inClient, attachment ? "ticket" : "blob"],
    ]);
    expect(JSON.stringify(observations(m))).not.toContain("private-");
  });

  it("records SDK decision errors but rethrows the original error (no new fallback)", async () => {
    const m = apiMock();
    const liff = registered();
    const error = new Error("private-sdk-error private-token");
    liff.isInClient = vi.fn(() => { throw error; });
    expect(() => serverAttachmentBranch(liff, "csv")).toThrow(error);
    expect(liff.isInClient).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(observations(m)).toHaveLength(1));
    expect(observations(m)[0]).toMatchObject({ event: "csv_branch", in_client: null, branch: "error" });
    expect(JSON.stringify(observations(m))).not.toContain("private-");
  });

  it("tolerates missing/throwing OS and logged-in probes", async () => {
    const m = apiMock();
    const liff = registered({ inClient: false });
    liff.getOS = () => { throw new Error("private-os-error"); };
    liff.isLoggedIn = () => { throw new Error("private-login-error"); };
    expect(serverAttachmentBranch(liff, "xlsx")).toBe(false);
    await vi.waitFor(() => expect(observations(m)).toHaveLength(1));
    expect(observations(m)[0]).toMatchObject({ os: "error", logged_in: null });
    Reflect.deleteProperty(liff, "getOS");
    serverAttachmentBranch(liff, "xlsx");
    await vi.waitFor(() => expect(observations(m)).toHaveLength(2));
    expect(observations(m)[1].os).toBe("unknown");
  });

  it("records init failure without the exception or token", async () => {
    const m = apiMock();
    const liff = registered({ init: new Error("private-init-error") });
    await expect(initWithTimeout(liff, 20_000)).rejects.toMatchObject({ code: "liff_timeout" });
    expect(observations(m)[0]).toMatchObject({ event: "init", init: "failed" });
    expect(JSON.stringify(observations(m))).not.toContain("private-");
  });

  it("automatically registers the real SDK adapter with its configured public ID", async () => {
    const m = apiMock();
    const liff = realLiff(LIFF_ID);
    liff.init = () => Promise.resolve();
    liff.isInClient = () => false;
    liff.isLoggedIn = () => false;
    liff.getOS = () => "ios";
    await initWithTimeout(liff, 20_000);
    await vi.waitFor(() => expect(observations(m)).toHaveLength(1));
    expect(observations(m)[0]).toMatchObject({ event: "init", init: "ready", liff_id: LIFF_ID, adapter: "real" });
  });

  it("records synchronous init failure once and retains the same error", async () => {
    vi.useFakeTimers();
    const m = apiMock();
    const liff = registered();
    const error = new Error("private-synchronous-error");
    liff.init = () => { throw error; };
    await expect(initWithTimeout(liff, 20)).rejects.toBe(error);
    await vi.advanceTimersByTimeAsync(20);
    expect(observations(m)).toHaveLength(1);
    expect(observations(m)[0]).toMatchObject({ event: "init", init: "failed" });
    expect(JSON.stringify(observations(m))).not.toContain("private-");
  });

  it("records timeout once even if the SDK eventually resolves", async () => {
    vi.useFakeTimers();
    const m = apiMock();
    const liff = registered();
    let finish!: () => void;
    liff.init = () => new Promise<void>((resolve) => { finish = resolve; });
    const pending = expect(initWithTimeout(liff, 20)).rejects.toMatchObject({ code: "liff_timeout" });
    await vi.advanceTimersByTimeAsync(20);
    await pending;
    finish();
    await Promise.resolve();
    expect(observations(m)).toHaveLength(1);
    expect(observations(m)[0]).toMatchObject({ event: "init", init: "timeout" });
  });

  it.each(["throw", "reject", "never", "401"])("report transport %s cannot block/change the branch or trigger logout", async (failure) => {
    vi.useFakeTimers();
    const m = apiMock();
    m.set("GET /api/v1/health", () => {
      if (failure === "throw") throw new Error("private-network-error");
      if (failure === "reject") return Promise.reject(new Error("private-network-error"));
      if (failure === "never") return new Promise<Response>(() => {});
      return json(401, { code: "unauthenticated" });
    });
    const liff = registered({ inClient: false });
    expect(serverAttachmentBranch(liff, "xlsx")).toBe(false);
    await vi.advanceTimersByTimeAsync(3000);
    expect(m.calls[0]!.signal.aborted).toBe(failure === "never");
    expect(liff.logout).not.toHaveBeenCalled();
  });

  it("bounds events and ignores console failures", async () => {
    const m = apiMock();
    const liff = registered({ inClient: false });
    vi.mocked(console.info).mockImplementation(() => { throw new Error("console unavailable"); });
    for (let i = 0; i < 30; i++) expect(serverAttachmentBranch(liff, "csv")).toBe(false);
    await vi.waitFor(() => expect(m.count("GET /api/v1/health")).toBe(24));
  });

  it("does not send diagnostics for an unregistered adapter", () => {
    const m = apiMock();
    expect(serverAttachmentBranch(fakeLiff({ inClient: false }), "xlsx")).toBe(false);
    expect(m.calls).toHaveLength(0);
  });
});
