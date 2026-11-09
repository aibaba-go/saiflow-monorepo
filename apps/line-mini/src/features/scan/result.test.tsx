import { act, screen, waitFor, within } from "@testing-library/react";
import userEventLib from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { translate } from "../../i18n";
import { useLanguage } from "../../stores/language";
import { ORG, PERSONAL, signedIn, USER } from "../../test/fixtures";
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

describe("template extra header fields on the result page (FR-SYS-105-05..10)", () => {
  /** Document has Billing No. and Date and a line table; Remark is not in the template. */
  const XGROUPS = [
    {
      key: "document",
      name: "Document",
      names: { th: "เอกสาร", zh: "单据" },
      items: [
        { kind: "field", key: "billing_no", name: "Billing No.", names: { th: "เลขที่ใบวางบิล", zh: "账单号" }, type: "string" },
        { kind: "field", key: "date", name: "Date", names: { th: "วันที่", zh: "日期" }, type: "date", required: true },
        { kind: "table", key: "invoices", name: "Invoices", columns: [{ key: "amount", name: "Amount", type: "amount" }] },
      ],
    },
  ];
  const base = { billing_no: "BN-1", date: "2026-11-01", invoices: [{ amount: "100.00" }] };
  const xresult = (version: number, document: Record<string, unknown>, over: Record<string, unknown> = {}) =>
    result(version, { document }, { template: { template_version_id: 3, name: "Billing Note", groups: XGROUPS }, ...over });
  const rowPaths = () => [...document.querySelectorAll("dl [data-path]")].map((el) => el.getAttribute("data-path"));
  const ORG_JOB = { created_by_user_id: USER.user_id };

  it("shows only saved extra fields, after the template's fields (105-05, 105-10)", async () => {
    let stored = xresult(2, base); // PC has an unsaved Remark: not visible here
    const api = mockApi({
      [`GET ${JOB}`]: () => json(200, job("VERIFYING")),
      [`GET ${JOB}/result`]: () => json(200, stored),
    });
    const first = page("result");
    expect(await screen.findByRole("textbox", { name: "Billing No." })).toHaveValue("BN-1");
    expect(screen.queryByText("Remark")).toBeNull();
    first.unmount();

    stored = xresult(3, { ...base, Remark: "Pay next week" }); // PC saved it
    const second = page("result");
    expect(await screen.findByRole("textbox", { name: "Remark" })).toHaveValue("Pay next week");
    expect(rowPaths()).toEqual(["document.billing_no", "document.date", "document.Remark"]);
    const remarkRow = document.querySelector('[data-path="document.Remark"]') as HTMLElement;
    const table = document.querySelector('[data-table="document.invoices"]') as HTMLElement;
    expect(remarkRow.compareDocumentPosition(table) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(screen.getByRole("textbox", { name: "Amount" })).toHaveValue("100.00");
    second.unmount();

    stored = xresult(4, base); // PC deleted it and saved
    page("result");
    expect(await screen.findByRole("textbox", { name: "Billing No." })).toHaveValue("BN-1");
    expect(screen.queryByText("Remark")).toBeNull();
    expect(rowPaths()).toEqual(["document.billing_no", "document.date"]);
    expect(api.calls.filter((c) => c.method !== "GET")).toHaveLength(0); // nothing written back
  });

  it.each([false, true])("edits an extra value and saves a new version (105-06, returned=%s)", async (returned) => {
    const back = { round_no: 1, level: 1, decision: "RETURN", comment: "税额不对", reviewer_name: "Ratana", created_at: "2026-11-06T03:00:00Z" };
    const review = { stage: "NONE", required_level: null, records: returned ? [back] : [], last_return: returned ? back : null };
    let stored = xresult(3, { ...base, Remark: "Pay next week" }, { review });
    const api = mockApi({
      [`GET ${JOB}`]: () => json(200, job("VERIFYING", { returned })),
      [`GET ${JOB}/result`]: () => json(200, stored),
      [`PATCH ${JOB}/result`]: async (r) => {
        const body = (await r.json()) as { structured: { document: Record<string, unknown> } };
        stored = xresult(4, body.structured.document, { review });
        return json(200, stored);
      },
    });
    page("result");
    const remark = await screen.findByRole("textbox", { name: "Remark" });
    await userEvent.clear(remark);
    await userEvent.type(remark, "Call supplier");
    await userEvent.click(screen.getByRole("button", { name: "Save draft" }));
    await waitFor(() => expect(api.count(`PATCH ${JOB}/result`)).toBe(1));
    const [body] = (await api.bodies(`PATCH ${JOB}/result`)) as { expected_version: number; structured: unknown }[];
    expect(body!.expected_version).toBe(3);
    expect(body!.structured).toEqual({ document: { ...base, Remark: "Call supplier" } });
    await waitFor(() => expect(screen.getByRole("textbox", { name: "Remark" })).toHaveValue("Call supplier"));
    if (returned) expect(screen.getByRole("note")).toHaveTextContent("税额不对");
  });

  it("no add or delete for template extra fields; the generic result keeps both (105-07)", async () => {
    mockApi({
      [`GET ${JOB}`]: () => json(200, job("VERIFYING")),
      [`GET ${JOB}/result`]: () => json(200, xresult(3, { ...base, Remark: "Pay next week" })),
    });
    const tpl = page("result");
    expect(await screen.findByRole("textbox", { name: "Remark" })).toBeEnabled();
    expect(screen.queryByRole("button", { name: /Add field/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Delete field/ })).toBeNull();
    expect(screen.getByRole("button", { name: "+ Add row" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete row 1" })).toBeInTheDocument();
    tpl.unmount();

    mockApi({
      [`GET ${JOB}`]: () => json(200, job("VERIFYING")),
      [`GET ${JOB}/result`]: () => json(200, result(1, { seller: { name: "S", Remark: "x" } }, { template: null })),
    });
    page("result");
    expect(await screen.findByRole("button", { name: "+ Add field" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete field: Remark" })).toBeInTheDocument();
  });

  it.each(["en", "th", "zh"] as const)("%s: names and values as saved, no new required rule (105-08)", async (lang) => {
    const saved = { ...base, date: "", Reference: "000123.4500", Remark: "" };
    const api = mockApi({
      [`GET ${JOB}`]: () => json(200, job("VERIFYING")),
      [`GET ${JOB}/result`]: () => json(200, xresult(3, saved, { missing_required: ["document.date"] })),
      [`PATCH ${JOB}/result`]: async (r) =>
        json(200, xresult(4, ((await r.json()) as { structured: { document: Record<string, unknown> } }).structured.document, { missing_required: ["document.date"] })),
    });
    useLanguage.getState().setLang(lang);
    page("result");
    const reference = await screen.findByRole("textbox", { name: "Reference" });
    expect(reference).toHaveValue("000123.4500");
    expect(screen.getByRole("textbox", { name: "Remark" })).toHaveValue("");
    expect(screen.getByRole("textbox", { name: (XGROUPS[0]!.items[1]!.names as Partial<Record<typeof lang, string>> | undefined)?.[lang] ?? "Date" })).toBeInTheDocument();
    // the template's Date is still required; the empty extra Remark is not
    expect((document.querySelector('[data-path="document.date"]') as HTMLElement).className).toContain("required-missing");
    const remarkRow = document.querySelector('[data-path="document.Remark"]') as HTMLElement;
    expect(remarkRow.className).not.toContain("required-missing");
    expect(within(remarkRow).queryByText("*")).toBeNull();
    // a blur does not round or strip the value; saving keeps the text
    await userEvent.type(reference, "0");
    await userEvent.tab();
    expect(reference).toHaveValue("000123.45000");
    await userEvent.click(screen.getByRole("button", { name: translate(lang, "result.saveDraft") }));
    await waitFor(() => expect(api.count(`PATCH ${JOB}/result`)).toBe(1));
    const [body] = (await api.bodies(`PATCH ${JOB}/result`)) as { structured: { document: Record<string, unknown> } }[];
    expect(body!.structured.document).toEqual({ ...saved, Reference: "000123.45000" });
  });

  it("read-only without edit permission or when locked (105-09)", async () => {
    const saved = xresult(3, { ...base, Remark: "Pay next week" });
    const cases = [
      // own job, but the role has no verify_own
      { tenant: { ...ORG, permissions: ["upload_ocr"] }, jobOver: ORG_JOB, res: saved },
      // a colleague's job with only verify_own
      { tenant: ORG, jobOver: { created_by_user_id: 99 }, res: saved },
      // locked: waiting for review, or confirmed
      { tenant: PERSONAL, jobOver: {}, res: { ...saved, confirmed: true, review: { stage: "PENDING_L1", required_level: 1, records: [], last_return: null } } },
      { tenant: PERSONAL, jobOver: {}, res: { ...saved, confirmed: true, review: { stage: "CONFIRMED", required_level: null, records: [], last_return: null } } },
    ];
    for (const c of cases) {
      signedIn(USER, c.tenant === PERSONAL ? [PERSONAL] : [PERSONAL, c.tenant]);
      useTenantChoice.getState().choose(c.tenant.tenant_id);
      mockApi({
        [`GET ${JOB}`]: () => json(200, job("VERIFYING", c.jobOver)),
        [`GET ${JOB}/result`]: () => json(200, c.res),
      });
      const view = page("result");
      expect(await screen.findAllByText("invoice.png")).not.toHaveLength(0); // the job is known
      expect(await screen.findByLabelText("Remark")).toHaveTextContent("Pay next week");
      expect(screen.queryByRole("textbox", { name: "Remark" })).toBeNull();
      expect(screen.queryByRole("textbox", { name: "Billing No." })).toBeNull();
      expect(screen.queryByRole("button", { name: /Add field|^Delete field/ })).toBeNull();
      view.unmount();
    }
  });

  it("an org member with verify_own edits their own job; verify_others edits a colleague's", async () => {
    const saved = xresult(3, { ...base, Remark: "Pay next week" });
    for (const c of [
      { tenant: ORG, jobOver: ORG_JOB },
      { tenant: { ...ORG, permissions: ["verify_others"] }, jobOver: { created_by_user_id: 99 } },
    ]) {
      signedIn(USER, [PERSONAL, c.tenant]);
      useTenantChoice.getState().choose(c.tenant.tenant_id);
      mockApi({
        [`GET ${JOB}`]: () => json(200, job("VERIFYING", c.jobOver)),
        [`GET ${JOB}/result`]: () => json(200, saved),
      });
      const view = page("result");
      await waitFor(() => expect(screen.getByRole("textbox", { name: "Remark" })).toBeEnabled());
      view.unmount();
    }
  });
});
