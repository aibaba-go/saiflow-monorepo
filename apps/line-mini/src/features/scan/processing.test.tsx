import { act, screen, waitFor, within } from "@testing-library/react";
import userEventLib from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLanguage } from "../../stores/language";
import { PERSONAL, signedIn, USER } from "../../test/fixtures";
import { json, mockApi } from "../../test/mockApi";
import { renderWithProviders } from "../../test/render";
import { useTenantChoice } from "../tenants/useCurrentTenant";
import { ProcessingPage } from "./ProcessingPage";
import { ResultPage } from "./ResultPage";

const userEvent = userEventLib.setup({ pointerEventsCheck: 0 });
const JOB = "/api/v1/ocr/jobs/j1";

const job = (stage: string, over: Record<string, unknown> = {}) => ({
  id: "j1",
  file_id: "f1",
  file_name: "invoice.png",
  page_count: 1,
  status: stage === "OCR_PROCESSING" ? "PROCESSING" : stage === "OCR_FAILED" ? "FAILED" : "SUCCEEDED",
  stage,
  error_code: null,
  engine: "textin",
  template_name: null,
  created_at: "2026-11-06T00:00:00Z",
  confirmed_at: null,
  ...over,
});

const GROUPS = [
  {
    key: "document",
    name: "Document",
    names: { en: "Document", th: "ข้อมูลเอกสาร", zh: "单据信息" },
    items: [
      { kind: "field", key: "invoice_no", name: "Tax Invoice No.", names: { zh: "税务发票号" }, type: "string", required: true },
      { kind: "field", key: "invoice_date", name: "Date", names: { zh: "日期" }, type: "date", required: true },
    ],
  },
  {
    key: "summary",
    name: "Summary",
    names: { zh: "汇总" },
    items: [{ kind: "field", key: "net_total", name: "Net Total", names: { zh: "总金额" }, type: "amount", required: false }],
  },
];

const result = (version: number, structured: unknown, over: Record<string, unknown> = {}) => ({
  version,
  structured,
  template: { template_version_id: 3, name: "Tax Invoice", groups: GROUPS },
  missing_required: [],
  mapping: null,
  confirmed: false,
  ...over,
});

function page(path: "progress" | "result") {
  return renderWithProviders(
    <Routes>
      <Route path="/scan/jobs/:id/progress" element={<ProcessingPage />} />
      <Route path="/scan/jobs/:id/result" element={<ResultPage />} />
      <Route path="/" element={<div>home page</div>} />
    </Routes>,
    { route: `/scan/jobs/j1/${path}` },
  );
}

beforeEach(() => {
  localStorage.clear();
  useLanguage.getState().setLang("en");
  useTenantChoice.getState().choose(null);
  signedIn(USER, [PERSONAL]);
});
afterEach(() => vi.useRealTimers());

describe("processing page copied from main (FR-SYS-059, 116)", () => {
  it("progress steps then result (059-01)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const stages = ["OCR_PROCESSING", "TEMPLATE_MATCHING", "VERIFYING"];
    let n = 0;
    mockApi({
      [`GET ${JOB}`]: () => json(200, job(stages[Math.min(n++, 2)]!)),
      [`GET ${JOB}/result`]: () => json(200, result(1, { document: { invoice_no: "IV1" } })),
    });
    page("progress");
    expect(await screen.findByText("OCR processing")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel task" })).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(await screen.findByDisplayValue("IV1")).toBeInTheDocument(); // the result page
  });

  it("90 s of matching goes to the result page, which shows matching", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockApi({
      [`GET ${JOB}`]: () => json(200, job("TEMPLATE_MATCHING")),
      [`GET ${JOB}/result`]: () =>
        json(200, result(1, {}, { template: null, mapping: { status: "CONVERTING", error: null } })),
    });
    page("progress");
    expect(await screen.findByText("Template matching")).toBeInTheDocument();
    await act(() => vi.advanceTimersByTimeAsync(89_000));
    expect(screen.queryByText("Matching the template…")).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(2_000));
    expect(await screen.findByText("Matching the template…")).toBeInTheDocument();
  });

  it("failure shows reason and rerun (059-02)", async () => {
    const api = mockApi({
      [`GET ${JOB}`]: () => json(200, job("OCR_FAILED", { error_code: "VENDOR_TIMEOUT" })),
      [`POST ${JOB}/rerun`]: () => json(201, job("OCR_PROCESSING", { id: "j2" })),
      "GET /api/v1/ocr/jobs/j2": () => json(200, job("OCR_PROCESSING", { id: "j2" })),
    });
    useLanguage.getState().setLang("zh");
    page("progress");
    expect(await screen.findByText("识别服务响应超时。")).toBeInTheDocument();
    expect(screen.getByText("扫描次数已退还。")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "重新识别" }));
    await waitFor(() => expect(api.count(`POST ${JOB}/rerun`)).toBe(1));
    await waitFor(() => expect(api.count("GET /api/v1/ocr/jobs/j2")).toBeGreaterThan(0));
  });

  it("cancel while processing after confirm", async () => {
    let cancelled = false;
    const api = mockApi({
      [`GET ${JOB}`]: () => json(200, cancelled ? job("OCR_FAILED", { status: "CANCELLED" }) : job("OCR_PROCESSING")),
      [`POST ${JOB}/cancel`]: () => {
        cancelled = true;
        return json(200, job("OCR_FAILED", { status: "CANCELLED" }));
      },
    });
    page("progress");
    await userEvent.click(await screen.findByRole("button", { name: "Cancel task" }));
    await userEvent.click(await screen.findByRole("button", { name: "Keep processing" })); // keep going
    expect(api.count(`POST ${JOB}/cancel`)).toBe(0);
    await userEvent.click(screen.getByRole("button", { name: "Cancel task" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Cancel task" }));
    expect(await screen.findByText(/Recognition was cancelled/)).toBeInTheDocument();
    expect(api.count(`POST ${JOB}/cancel`)).toBe(1);
  });

  it("leave the page (116-01)", async () => {
    const api = mockApi({ [`GET ${JOB}`]: () => json(200, job("OCR_PROCESSING")) });
    page("progress");
    expect(await screen.findByText(/keeps running in the background/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Back to home" }));
    expect(await screen.findByText("home page")).toBeInTheDocument();
    const before = api.count(`GET ${JOB}`);
    await new Promise((r) => setTimeout(r, 2_300));
    expect(api.count(`GET ${JOB}`)).toBe(before); // no more polling once the page is gone
  });
});
