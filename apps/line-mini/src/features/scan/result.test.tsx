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

describe("result page copied from main (FR-SYS-105, 114, 115)", () => {
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
    expect(date.className).toContain("required-missing");
    expect(within(date).getByText("*")).toBeInTheDocument();
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
    await userEvent.click(screen.getByRole("button", { name: /^Template/ }));
    await userEvent.click(await screen.findByRole("radio", { name: /No template \(generic result\)/ }));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    await userEvent.click(await screen.findByRole("button", { name: "Save and switch" }));
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

  it("no editing while a conversion runs, so its result cannot wipe edits", async () => {
    mockApi({
      [`GET ${JOB}`]: () => json(200, job("TEMPLATE_MATCHING")),
      [`GET ${JOB}/result`]: () =>
        json(200, result(1, { a: "1" }, { template: null, mapping: { status: "CONVERTING", error: null } })),
    });
    page("result");
    expect(await screen.findByText("Applying template…")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByLabelText("a")).toHaveTextContent("1");
  });

  it("a failed conversion shows the reason", async () => {
    mockApi({
      [`GET ${JOB}`]: () => json(200, job("VERIFYING")),
      [`GET ${JOB}/result`]: () =>
        json(200, result(1, { a: "1" }, { template: null, mapping: { status: "FAILED", error: "PRIMARY_MISSING" } })),
    });
    page("result");
    expect(await screen.findByText(/does not fit this template/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Choose another template" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Use generic result" })).toBeEnabled();
  });

  it("json tab and copy (114-01)", async () => {
    const writes: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      value: { writeText: (s: string) => (writes.push(s), Promise.resolve()) },
      configurable: true,
    });
    mockApi({
      [`GET ${JOB}`]: () => json(200, job("VERIFYING")),
      [`GET ${JOB}/result`]: () => json(200, result(1, { document: { invoice_no: "IV1" } })),
    });
    page("result");
    await userEvent.click(await screen.findByRole("tab", { name: "JSON" }));
    await userEvent.click(screen.getByRole("button", { name: "Copy" }));
    expect(await screen.findByText("Copied")).toBeInTheDocument();
    expect(JSON.parse(writes[0]!)).toEqual({ document: { invoice_no: "IV1" } });
  });

  it("field name checks (114-02)", async () => {
    mockApi({
      [`GET ${JOB}`]: () => json(200, job("VERIFYING")),
      [`GET ${JOB}/result`]: () =>
        json(200, result(1, { seller: { name: "S" } }, { template: null })),
    });
    page("result");
    await userEvent.click(await screen.findByRole("button", { name: "+ Add field" }));
    await userEvent.click(screen.getByRole("button", { name: "Add field" }));
    expect(await screen.findByText(/Enter a field name/)).toBeInTheDocument();
    await userEvent.type(screen.getByRole("textbox", { name: "Field name" }), "name");
    await userEvent.click(screen.getByRole("button", { name: "Add field" }));
    expect(await screen.findByText(/already exists/)).toBeInTheDocument();
    await userEvent.clear(screen.getByRole("textbox", { name: "Field name" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Field name" }), "phone");
    await userEvent.click(screen.getByRole("button", { name: "Add field" }));
    expect(await screen.findByRole("textbox", { name: "phone" })).toBeInTheDocument();
  });

  it("reset discards unsaved edits (114-03; Review Focus 4)", async () => {
    const api = mockApi({
      [`GET ${JOB}`]: () => json(200, job("VERIFYING")),
      [`GET ${JOB}/result`]: () =>
        json(200, result(2, { document: { invoice_no: "IV1" }, summary: { net_total: "10.00" } })),
    });
    page("result");
    const reset = await screen.findByRole("button", { name: "Reset" });
    expect(reset).toBeDisabled(); // nothing to reset yet
    const no = screen.getByRole("textbox", { name: "Tax Invoice No." });
    await userEvent.clear(no);
    await userEvent.type(no, "IV9");
    await userEvent.click(reset);
    const dialog = await screen.findByRole("dialog", { name: "Reset changes?" });
    await userEvent.click(within(dialog).getByRole("button", { name: "Reset" }));
    expect(await screen.findByRole("textbox", { name: "Tax Invoice No." })).toHaveValue("IV1");
    expect(api.calls.filter((c) => c.method !== "GET")).toHaveLength(0); // no request, same version
  });

  it("free form without error (019-02)", async () => {
    mockApi({
      [`GET ${JOB}`]: () => json(200, job("VERIFYING")),
      [`GET ${JOB}/result`]: () => json(200, result(1, { buyer: { name: "B" } }, { template: null })),
    });
    page("result");
    expect(await screen.findByRole("textbox", { name: "name" })).toHaveValue("B");
    expect(screen.getByText("No template (generic result)")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("amount issue and warning marks", async () => {
    mockApi({
      [`GET ${JOB}`]: () => json(200, job("VERIFYING")),
      [`GET ${JOB}/result`]: () =>
        json(
          200,
          result(1, { summary: { net_total: "1075.00" }, document: { invoice_date: "abc" } }, {
            amount_issues: [{ path: "summary.net_total", computed: "1070.00", recognised: "1075.00" }],
            warnings: [{ path: "document.invoice_date", code: "type_mismatch" }],
          }),
        ),
    });
    page("result");
    expect(await screen.findByText("1 amount(s) do not add up. Please check them.")).toBeInTheDocument();
    expect(screen.getByText("Calculated: 1070.00")).toBeInTheDocument();
    expect((document.querySelector('[data-path="summary.net_total"]') as HTMLElement).className).toContain("amount-issue");
    expect((document.querySelector('[data-path="document.invoice_date"]') as HTMLElement).className).toContain("type-warning");
  });

  it("low score notice (024-02)", async () => {
    mockApi({
      [`GET ${JOB}`]: () => json(200, job("VERIFYING")),
      [`GET ${JOB}/result`]: () =>
        json(200, result(1, {}, { match: { template_version_id: 3, score: 0.45, low_score: true } })),
    });
    page("result");
    expect(await screen.findByText(/Low match score \(45%\)/)).toBeInTheDocument();
  });

  it("preview then apply (115-01)", async () => {
    const applied: unknown[] = [];
    const api = mockApi({
      [`GET ${JOB}`]: () => json(200, job("VERIFYING")),
      [`GET ${JOB}/result`]: () => json(200, result(1, { buyer: { name: "B" } }, { template: null })),
      [`GET ${JOB}/template-options`]: () =>
        json(200, {
          templates: [
            { template_id: 2, template_version_id: 7, code: "billing_note", name: "Billing Note", score: 0.92, recommended: true },
            { template_id: 1, template_version_id: 3, code: "tax_invoice", name: "Tax Invoice", score: 0.35, recommended: false },
          ],
          generic: true,
          current_template_version_id: null,
          attempts: 1,
          limit: 5,
          last_failure: null,
        }),
      "GET /api/v1/templates/versions/7": () =>
        json(200, { template_version_id: 7, template_id: 2, code: "billing_note", name: "Billing Note", groups: GROUPS }),
      [`POST ${JOB}/template`]: async (r) => {
        applied.push(await r.json());
        return json(202, { result: "started", mapping_id: "m1" });
      },
    });
    page("result");
    await userEvent.click(await screen.findByRole("button", { name: /^Template/ }));
    expect(await screen.findByText("Recommended")).toBeInTheDocument();
    expect(screen.getByText("92%")).toBeInTheDocument();
    await userEvent.click(screen.getAllByText("Preview fields")[0]!);
    expect(await screen.findByText("Tax Invoice No.")).toBeInTheDocument(); // the previewed fields
    await userEvent.click(screen.getByRole("radio", { name: /Billing Note/ }));
    await userEvent.click(screen.getByRole("button", { name: "Apply" }));
    await waitFor(() => expect(applied).toEqual([{ template_version_id: 7 }]));
    expect(api.count("GET /api/v1/templates/versions/7")).toBe(1);
  });

  it("still processing after 10 minutes (115-02)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    mockApi({
      [`GET ${JOB}`]: () => json(200, job("TEMPLATE_MATCHING")),
      [`GET ${JOB}/result`]: () =>
        json(200, result(1, { a: "1" }, { template: null, mapping: { status: "CONVERTING", error: null } })),
    });
    page("result");
    expect(await screen.findByText("Applying template…")).toBeInTheDocument();
    expect(screen.queryByText(/Still processing after 10 minutes/)).toBeNull();
    await act(() => vi.advanceTimersByTimeAsync(10 * 60_000 + 10));
    expect(await screen.findByText(/Still processing after 10 minutes/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Use generic result" })).toBeInTheDocument();
  });
});
