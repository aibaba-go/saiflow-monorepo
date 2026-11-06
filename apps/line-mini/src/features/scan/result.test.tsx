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

describe("progress (FR-SYS-059)", () => {
  it("progress steps then result (059-01)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const stages = ["OCR_PROCESSING", "TEMPLATE_MATCHING", "VERIFYING"];
    let n = 0;
    mockApi({
      [`GET ${JOB}`]: () => json(200, job(stages[Math.min(n++, 2)]!)),
      [`GET ${JOB}/result`]: () => json(200, result(1, { document: { invoice_no: "IV1" } })),
    });
    page("progress");
    expect(await screen.findByText("Recognition")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancel recognition" })).toBeInTheDocument();
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
    await userEvent.click(await screen.findByRole("button", { name: "Cancel recognition" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" })); // keep going
    expect(api.count(`POST ${JOB}/cancel`)).toBe(0);
    await userEvent.click(screen.getByRole("button", { name: "Cancel recognition" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    expect(await screen.findByText(/Recognition was cancelled/)).toBeInTheDocument();
    expect(api.count(`POST ${JOB}/cancel`)).toBe(1);
  });
});

describe("result page (FR-SYS-105)", () => {
  it("labels in Chinese, decimal kept, required marked (105-01)", async () => {
    let saved: unknown = null;
    const api = mockApi({
      [`GET ${JOB}`]: () => json(200, job("VERIFYING")),
      [`GET ${JOB}/result`]: () =>
        json(200, saved ?? result(1, { document: { invoice_no: "IV1", invoice_date: "" }, summary: { net_total: "10.00" } }, { missing_required: ["document.invoice_date"] })),
      [`PATCH ${JOB}/result`]: async (r) => {
        const body = (await r.json()) as { structured: unknown };
        saved = result(2, body.structured, { missing_required: ["document.invoice_date"] });
        return json(200, saved);
      },
    });
    useLanguage.getState().setLang("zh");
    page("result");
    const total = await screen.findByRole("textbox", { name: "总金额" });
    expect(screen.getByRole("textbox", { name: "税务发票号" })).toHaveValue("IV1");
    const date = document.querySelector('[data-path="document.invoice_date"]') as HTMLElement;
    expect(date.className).toContain("result__field--missing");
    expect(within(date).getByText("必填")).toBeInTheDocument();
    await userEvent.clear(total);
    await userEvent.type(total, "1,234.50");
    await userEvent.tab();
    expect(total).toHaveValue("1234.50");
    await userEvent.click(screen.getByRole("button", { name: "保存草稿" }));
    await waitFor(() => expect(api.count(`PATCH ${JOB}/result`)).toBe(1));
    const [body] = (await api.bodies(`PATCH ${JOB}/result`)) as { expected_version: number; structured: { summary: { net_total: string } } }[];
    expect(body!.expected_version).toBe(1);
    expect(body!.structured.summary.net_total).toBe("1234.50");
    expect(await screen.findByRole("textbox", { name: "总金额" })).toHaveValue("1234.50");
  });

  it("switch to generic saves the draft first (105-02)", async () => {
    const order: string[] = [];
    let generic = false;
    mockApi({
      [`GET ${JOB}`]: () => json(200, job("VERIFYING")),
      [`GET ${JOB}/result`]: () =>
        json(200, generic ? result(3, { buyer: { name: "B" } }, { template: null }) : result(1, { document: { invoice_no: "IV1" } })),
      [`PATCH ${JOB}/result`]: async (r) => {
        order.push("save");
        return json(200, result(2, ((await r.json()) as { structured: unknown }).structured));
      },
      [`GET ${JOB}/template-options`]: () =>
        json(200, {
          templates: [{ template_id: 1, template_version_id: 3, code: "tax_invoice", name: "Tax Invoice" }],
          generic: true,
          current_template_version_id: 3,
          attempts: 1,
          limit: 5,
          last_failure: null,
        }),
      [`POST ${JOB}/generic`]: () => {
        order.push("generic");
        generic = true;
        return json(200, { result: "switched", mapping_id: null });
      },
    });
    page("result");
    const no = await screen.findByRole("textbox", { name: "Tax Invoice No." });
    await userEvent.type(no, "9");
    await userEvent.click(screen.getByRole("button", { name: "Change template" }));
    await userEvent.click(await screen.findByRole("button", { name: "Generic result" }));
    await waitFor(() => expect(order).toEqual(["save", "generic"]));
    expect(await screen.findByRole("textbox", { name: "name" })).toHaveValue("B");
  });

  it("conflict reloads latest (105-03)", async () => {
    let latest = false;
    mockApi({
      [`GET ${JOB}`]: () => json(200, job("VERIFYING")),
      [`GET ${JOB}/result`]: () =>
        json(200, latest ? result(5, { document: { invoice_no: "THEIRS" } }) : result(4, { document: { invoice_no: "IV1" } })),
      [`PATCH ${JOB}/result`]: () => {
        latest = true;
        return json(409, { code: "version_conflict" });
      },
    });
    page("result");
    await userEvent.type(await screen.findByRole("textbox", { name: "Tax Invoice No." }), "X");
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    expect(await screen.findByText(/Someone else changed this result/)).toBeInTheDocument();
    expect(await screen.findByDisplayValue("THEIRS")).toBeInTheDocument();
  });

  it("a failed conversion shows the reason", async () => {
    mockApi({
      [`GET ${JOB}`]: () => json(200, job("VERIFYING")),
      [`GET ${JOB}/result`]: () =>
        json(200, result(1, { a: "1" }, { template: null, mapping: { status: "FAILED", error: "PRIMARY_MISSING" } })),
    });
    page("result");
    expect(await screen.findByText(/does not fit this template/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Change template" })).toBeEnabled();
  });
});
