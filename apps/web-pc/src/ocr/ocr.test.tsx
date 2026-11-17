import { act, fireEvent, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEventLib from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { translate, type MessageKey } from "../i18n";
import { ReadonlyResult } from "../reviews/ReadonlyResult";
import { type Lang, useLanguage } from "../stores/language";
import { json, mockApi } from "../test/mockApi";
import { renderWithProviders } from "../test/render";
import { EditableResult } from "./EditableResult";
import { jobTarget, stageKey } from "./stage";
import type { Group, Json } from "./structured";
import { useUploadQueue } from "./uploadQueue";

const userEvent = userEventLib.setup({ pointerEventsCheck: 0 });

const GROUPS: Group[] = [
  {
    key: "document",
    name: "Document",
    items: [
      { kind: "field", key: "invoice_no", name: "Invoice No.", type: "string", required: true },
      { kind: "field", key: "total", name: "Total", type: "amount" },
    ],
  },
  {
    key: "goods",
    name: "Goods",
    items: [{ kind: "table", key: "line_items", name: "Line items", columns: [{ key: "qty", name: "Qty", type: "integer" }] }],
  },
];

function Harness({
  initial,
  groups = GROUPS,
  missing = [],
  editable = true,
}: {
  initial: Json;
  groups?: Group[] | null;
  missing?: string[];
  editable?: boolean;
}) {
  const [value, setValue] = useState<Json>(initial);
  return (
    <>
      <EditableResult
        value={value}
        groups={groups}
        missing={new Set(missing)}
        warnings={new Set()}
        amountIssues={new Map()}
        editable={editable}
        onChange={setValue}
      />
      <pre data-testid="value">{JSON.stringify(value)}</pre>
    </>
  );
}

const current = () => JSON.parse(screen.getByTestId("value").textContent || "null");

describe("stage helpers", () => {
  it("jobTarget routes by stage and permission", () => {
    expect(jobTarget({ id: "j1", stage: "VERIFYING" }, true)).toBe("/verify/j1");
    expect(jobTarget({ id: "j1", stage: "VERIFYING" }, false)).toBe("/documents/j1");
    expect(jobTarget({ id: "j1", stage: "OCR_FAILED" }, true)).toBe("/upload?job=j1");
    expect(jobTarget({ id: "j1", stage: "OCR_PROCESSING" }, true)).toBe("/upload?job=j1");
    expect(jobTarget({ id: "j1", stage: "TEMPLATE_MATCHING" }, true)).toBe("/upload?job=j1");
    expect(jobTarget({ id: "j1", stage: "CONFIRMED" }, true)).toBe("/documents/j1");
    expect(jobTarget({ id: "j1", stage: "PENDING_REVIEW" }, true)).toBe("/documents/j1");
  });

  it("stageKey adds the review level", () => {
    expect(stageKey("PENDING_REVIEW", 1)).toBe("review.pending1");
    expect(stageKey("PENDING_REVIEW", 2)).toBe("review.pending2");
    expect(stageKey("VERIFYING", null)).toBe("stage.VERIFYING");
  });
});

describe("EditableResult", () => {
  it("numbers in a table are right-aligned with even digits (FR-SYS-136-02)", () => {
    renderWithProviders(<Harness initial={{ document: { invoice_no: "IV1", total: "" }, goods: { line_items: [{ qty: "1" }, { qty: "950" }] } }} />);
    const qty = screen.getByRole("textbox", { name: "Qty 2" });
    expect(qty).toHaveClass("num", "num--right");
    expect(qty.closest("td")).toHaveClass("ant-table-cell", "num");
    expect(screen.getByRole("textbox", { name: "Invoice No." })).not.toHaveClass("num");
  });
  it("edits a field and a row", async () => {
    renderWithProviders(<Harness initial={{ document: { invoice_no: "IV1", total: "" }, goods: { line_items: [{ qty: "1" }] } }} />);
    const no = screen.getByRole("textbox", { name: "Invoice No." });
    await userEvent.clear(no);
    await userEvent.type(no, "IV9");
    expect(current().document.invoice_no).toBe("IV9");
    await userEvent.click(screen.getByRole("button", { name: "Add row" }));
    expect(current().goods.line_items).toHaveLength(2);
    const rows = screen.getAllByRole("button", { name: "Delete row" });
    await userEvent.click(rows[1]!);
    expect(current().goods.line_items).toEqual([{ qty: "1" }]);
  });

  it("marks missing and keeps decimal text", async () => {
    renderWithProviders(<Harness initial={{ document: { invoice_no: "", total: "" } }} missing={["document.invoice_no"]} />);
    const total = screen.getByRole("textbox", { name: "Total" });
    await userEvent.type(total, "1,234.50");
    expect(current().document.total).toBe("1234.50");
    const box = document.querySelector('[data-path="document.invoice_no"]') as HTMLElement;
    expect(box.className).toContain("required-missing");
  });

  it("generic result add field requires a unique name", async () => {
    renderWithProviders(<Harness initial={{ header: { seller: "A" } }} groups={null} />);
    await userEvent.click(screen.getByRole("button", { name: "Add field" }));
    const dialog = await screen.findByRole("dialog");
    const ok = within(dialog).getByRole("button", { name: "Add" });
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Field name" }), "seller");
    await userEvent.click(ok);
    expect(await within(dialog).findByText("This name is already used in the group.")).toBeInTheDocument();
    await userEvent.clear(within(dialog).getByRole("textbox", { name: "Field name" }));
    await userEvent.type(within(dialog).getByRole("textbox", { name: "Field name" }), "buyer");
    await userEvent.click(ok);
    await waitFor(() => expect(current().header).toEqual({ seller: "A", buyer: "" }));
  });

  it("expands a line table into a movable dialog that edits the same draft (FR-SYS-129-11)", async () => {
    renderWithProviders(<Harness initial={{ document: { invoice_no: "IV1", total: "" }, goods: { line_items: [{ qty: "1" }] } }} />);
    expect(screen.getByText("Rows: 1")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Expand: Line items" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("Drag the title bar to move")).toBeInTheDocument();

    const qty = within(dialog).getByRole("textbox", { name: "Qty 1" });
    await userEvent.clear(qty);
    await userEvent.type(qty, "5");
    expect(current().goods.line_items).toEqual([{ qty: "5" }]);
    // the compact table beside it shows the same draft
    expect(screen.getAllByRole("textbox", { name: "Qty 1" }).map((i) => (i as HTMLInputElement).value)).toEqual(["5", "5"]);

    await userEvent.click(within(dialog).getByRole("button", { name: /Add row/ }));
    expect(current().goods.line_items).toEqual([{ qty: "5" }, { qty: "" }]);
    expect(within(dialog).getByRole("textbox", { name: "Qty 2" })).toBeInTheDocument();
    await userEvent.click(within(dialog).getAllByRole("button", { name: "Delete row" })[1]!);
    expect(current().goods.line_items).toEqual([{ qty: "5" }]);

    // moved by its title bar
    const bar = within(dialog).getByTestId("rows-dialog-bar");
    fireEvent.pointerDown(bar, { button: 0, clientX: 100, clientY: 100, pointerId: 1 });
    fireEvent.pointerMove(bar, { clientX: 160, clientY: 140, pointerId: 1 });
    fireEvent.pointerUp(bar, { pointerId: 1 });
    const moved = bar.closest<HTMLElement>('[style*="translate"]');
    expect(moved?.style.transform).toBe("translate(60px, 40px)");

    // Done closes it (jsdom never finishes the leave animation, so the closing motion is checked)
    await userEvent.click(within(dialog).getByRole("button", { name: "Done" }));
    await waitFor(() => expect(dialog.closest(".ant-modal")?.className ?? "").toMatch(/leave/));
    expect(current().goods.line_items).toEqual([{ qty: "5" }]);
  });

  it("read-only tables can still be expanded, without editing (FR-SYS-129-11)", async () => {
    renderWithProviders(<Harness initial={{ goods: { line_items: [{ qty: "3" }] } }} editable={false} />);
    await userEvent.click(screen.getByRole("button", { name: "Expand: Line items" }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("textbox", { name: "Qty 1" })).toBeDisabled();
    expect(within(dialog).queryByRole("button", { name: /Add row/ })).toBeNull();
    expect(within(dialog).queryByRole("button", { name: "Delete row" })).toBeNull();
  });

  it("shows nested objects as fields and lists of rows as tables, not JSON text (FR-SYS-129-12)", async () => {
    renderWithProviders(
      <Harness
        initial={{ header: { seller: "A", address: { city: "Bangkok", zip: "10110" }, notes: [{ text: "x" }] } }}
        groups={null}
      />,
    );
    const city = screen.getByRole("textbox", { name: "city" });
    expect(city).toHaveValue("Bangkok");
    await userEvent.type(city, "!");
    expect(current().header.address).toEqual({ city: "Bangkok!", zip: "10110" });
    expect(screen.getByRole("textbox", { name: "text 1" })).toHaveValue("x");
    expect(screen.queryByDisplayValue(/\{|\[/)).toBeNull();
  });

  it("a template group shows an extra list of rows as a table (FR-SYS-129-12)", async () => {
    const initial = { document: { ...SAVED.document, extra_lines: [{ sku: "A1" }] }, payment: SAVED.payment };
    renderWithProviders(<Harness initial={initial} groups={TPL} />);
    const sku = screen.getByRole("textbox", { name: "sku 1" });
    await userEvent.type(sku, "0");
    expect(current().document.extra_lines).toEqual([{ sku: "A10" }]);
    expect(screen.getByRole("button", { name: "Expand: extra_lines" })).toBeInTheDocument();
  });
});

/** A template result whose Document group has header fields and a line table (FR-SYS-129). */
const TPL: Group[] = [
  {
    key: "document",
    name: "Document",
    names: { th: "เอกสาร", zh: "单据" },
    items: [
      { kind: "field", key: "billing_no", name: "Billing No.", names: { th: "เลขที่ใบวางบิล", zh: "账单号" } },
      { kind: "field", key: "date", name: "Date", names: { th: "วันที่", zh: "日期" }, type: "date", required: true },
      { kind: "table", key: "invoices", name: "Invoices", names: { th: "ใบแจ้งหนี้", zh: "发票" }, columns: [{ key: "amount", name: "Amount", type: "amount" }] },
    ],
  },
  { key: "payment", name: "Payment", names: { th: "การชำระ", zh: "付款" }, items: [{ kind: "field", key: "bank", name: "Bank" }] },
];
const SAVED = {
  document: { billing_no: "BN-1", date: "2026-11-01", invoices: [{ amount: "100.00" }], Remark: "Pay next week" },
  payment: { bank: "KBank" },
};

describe("template extra header fields (FR-SYS-129-06..10)", { timeout: 60_000 }, () => {
  const tr = (key: MessageKey, lang: Lang = "en") => translate(lang, key);
  const card = (title: string) => screen.getByText(title, { selector: ".ant-card-head-title" }).closest(".ant-card") as HTMLElement;
  const labels = (el: HTMLElement) => within(el).getAllByRole("textbox").map((i) => i.getAttribute("aria-label"));

  /** antd puts a space between two CJK characters in a button ("新 增"). */
  const btn = (text: string) =>
    new RegExp(`^${[...text].map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("\\s*")}$`);

  /** Open "Add field" in a group, enter the name and press Add; the group's dialog is returned. */
  async function tryAdd(group: string, name: string, lang: Lang = "en") {
    await userEvent.click(within(card(group)).getByRole("button", { name: btn(tr("ocr.addField", lang)) }));
    const dialogs = await screen.findAllByRole("dialog");
    const dialog = dialogs[dialogs.length - 1]!; // each group has its own dialog, the latest opened last
    fireEvent.change(within(dialog).getByRole("textbox", { name: tr("ocr.fieldName", lang) }), { target: { value: name } });
    await userEvent.click(within(dialog).getByRole("button", { name: btn(tr("ocr.add", lang)) }));
    return dialog;
  }
  async function cancel(dialog: HTMLElement, lang: Lang = "en") {
    await userEvent.click(within(dialog).getByRole("button", { name: btn(tr("common.cancel", lang)) }));
  }

  beforeEach(() => useLanguage.getState().setLang("en"));
  afterEach(() => useLanguage.getState().setLang("en"));

  it("adds a trimmed field after the template fields and before the table (129-06)", async () => {
    const { document: doc, payment } = SAVED;
    const plain = Object.fromEntries(Object.entries(doc).filter(([k]) => k !== "Remark"));
    renderWithProviders(<Harness initial={{ document: plain, payment }} groups={TPL} />);
    const dialog = await tryAdd("Document", " Remark ");
    expect(dialog).not.toHaveTextContent(tr("ocr.fieldNameTaken"));
    await waitFor(() => expect(current().document).toEqual({ ...plain, Remark: "" })); // starts empty, nothing else changed
    const remark = screen.getByRole("textbox", { name: "Remark" });
    await userEvent.type(remark, "Pay next week");
    expect(current().document).toEqual({ ...plain, Remark: "Pay next week" });
    expect(current().payment).toEqual(payment);
    // template fields keep their order; the extra field follows them, the table comes last
    expect(labels(card("Document"))).toEqual(["Billing No.", "Date", "Remark", "Amount 1"]);
  });

  it("shows a saved extra field, still editable, after the template fields (129-06 reopen)", async () => {
    renderWithProviders(<Harness initial={SAVED} groups={TPL} />);
    expect(labels(card("Document"))).toEqual(["Billing No.", "Date", "Remark", "Amount 1"]);
    const remark = screen.getByRole("textbox", { name: "Remark" });
    expect(remark).toHaveValue("Pay next week");
    expect(remark).toBeEnabled();
    await userEvent.type(remark, "!");
    expect(current().document.Remark).toBe("Pay next week!");
  });

  it("rejects a blank name and names taken in the group, saved or not (129-07)", async () => {
    renderWithProviders(<Harness initial={SAVED} groups={TPL} />);
    // an unsaved new field Memo first
    await tryAdd("Document", "Memo");
    await screen.findByRole("textbox", { name: "Memo" });
    await userEvent.type(screen.getByRole("textbox", { name: "Memo" }), "draft note");
    const before = current();

    let dialog = await tryAdd("Document", "   ");
    expect(await within(dialog).findByText(tr("ocr.fieldNameRequired"))).toBeInTheDocument();
    await cancel(dialog);
    for (const name of [" date ", "invoices", "billing_no", "Remark", " Memo "]) {
      dialog = await tryAdd("Document", name);
      expect(await within(dialog).findByText(tr("ocr.fieldNameTaken"))).toBeInTheDocument();
      await cancel(dialog);
      expect(current()).toEqual(before); // nothing added or overwritten
    }
    expect(current().document.Memo).toBe("draft note");
    expect(current().document.invoices).toEqual([{ amount: "100.00" }]);

    // the same name in another group is fine
    await tryAdd("Payment", "Remark");
    await waitFor(() => expect(current().payment).toEqual({ bank: "KBank", Remark: "" }));
    expect(current().payment).toEqual({ bank: "KBank", Remark: "" });
    expect(current().document.Remark).toBe("Pay next week");
  });

  it("cancel keeps the draft; only extra fields can be deleted (129-08)", async () => {
    renderWithProviders(<Harness initial={SAVED} groups={TPL} />);
    const before = current();
    await userEvent.click(within(card("Document")).getByRole("button", { name: tr("ocr.addField") }));
    const dialog = await screen.findByRole("dialog");
    fireEvent.change(within(dialog).getByRole("textbox", { name: tr("ocr.fieldName") }), { target: { value: "Note" } });
    await cancel(dialog);
    expect(current()).toEqual(before);
    expect(screen.queryByRole("textbox", { name: "Note" })).toBeNull();

    expect(screen.queryByRole("button", { name: `${tr("ocr.deleteField")}: Date` })).toBeNull();
    expect(screen.queryByRole("button", { name: `${tr("ocr.deleteField")}: Billing No.` })).toBeNull();
    expect(within(card("Document")).getAllByRole("button", { name: new RegExp(`^${tr("ocr.deleteField")}`) })).toHaveLength(1);
    await userEvent.click(screen.getByRole("button", { name: `${tr("ocr.deleteField")}: Remark` }));
    const rest = Object.fromEntries(Object.entries(SAVED.document).filter(([k]) => k !== "Remark"));
    expect(current().document).toEqual(rest);
    expect(screen.getByRole("textbox", { name: "Date" })).toHaveValue("2026-11-01");
    expect(screen.queryByRole("textbox", { name: "Remark" })).toBeNull();
  });

  it("read-only result: extra fields shown, no add or delete (129 locked)", () => {
    renderWithProviders(<Harness initial={SAVED} groups={TPL} editable={false} />);
    expect(screen.getByRole("textbox", { name: "Remark" })).toHaveValue("Pay next week");
    expect(screen.getByRole("textbox", { name: "Remark" })).toBeDisabled();
    expect(screen.queryByRole("button", { name: tr("ocr.addField") })).toBeNull();
    expect(screen.queryByRole("button", { name: new RegExp(`^${tr("ocr.deleteField")}`) })).toBeNull();
  });

  it("keeps extra values as typed text, never through a number (129 precision)", async () => {
    const initial = { document: { ...SAVED.document, Reference: "000123.4500" }, payment: SAVED.payment };
    renderWithProviders(<Harness initial={initial} groups={TPL} />);
    expect(screen.getByRole("textbox", { name: "Reference" })).toHaveValue("000123.4500");
    const remark = screen.getByRole("textbox", { name: "Remark" });
    await userEvent.clear(remark);
    await userEvent.type(remark, "1,234.50");
    expect(current().document.Remark).toBe("1,234.50");
    expect(current().document.Reference).toBe("000123.4500");
    // the template's amount column keeps its own rule
    const amount = screen.getByRole("textbox", { name: "Amount 1" });
    await userEvent.clear(amount);
    await userEvent.type(amount, "1,234.50");
    expect(current().document.invoices).toEqual([{ amount: "1234.50" }]);
  });

  it.each(["en", "th", "zh"] as const)("uses %s for actions and messages; entered names stay as typed (129-10)", async (lang) => {
    useLanguage.getState().setLang(lang);
    const group = TPL[0]!.names?.[lang] ?? "Document";
    renderWithProviders(<Harness initial={SAVED} groups={TPL} />);
    expect(screen.getByRole("textbox", { name: TPL[0]!.items[1]!.names![lang] ?? "Date" })).toHaveValue("2026-11-01");
    expect(screen.getByRole("textbox", { name: "Remark" })).toHaveValue("Pay next week");
    expect(screen.getByRole("button", { name: `${tr("ocr.deleteField", lang)}: Remark` })).toBeInTheDocument();
    expect(within(card(group)).getByRole("button", { name: btn(tr("ocr.addField", lang)) })).toBeInTheDocument();

    let dialog = await tryAdd(group, "", lang);
    expect(within(dialog).getByText(tr("ocr.addField", lang), { selector: ".ant-modal-title" })).toBeInTheDocument();
    expect(await within(dialog).findByText(tr("ocr.fieldNameRequired", lang))).toBeInTheDocument();
    await cancel(dialog, lang);
    dialog = await tryAdd(group, "Remark", lang);
    expect(await within(dialog).findByText(tr("ocr.fieldNameTaken", lang))).toBeInTheDocument();
    await cancel(dialog, lang);
    expect(current()).toEqual(SAVED);
  });
});

describe("read-only generic tables (FR-SYS-131, FR-SYS-124, FR-SYS-105)", () => {
  it.each(["en", "th", "zh"] as const)("%s renders any top-level detail array with columns from all rows", (lang) => {
    const data = {
      name: "Test statement",
      arbitrary_details: [
        { amount: "12345678901234567890.00", description: "<img src=x onerror=alert(1)>" },
        { amount: 0, description: null, posted: false },
      ],
      grouped: { items: [{ quantity: "2" }] },
    };
    renderWithProviders(<ReadonlyResult value={data} groups={null} lang={lang} t={(key) => translate(lang, key)} />);
    const tables = document.querySelectorAll<HTMLElement>(".ant-table table");
    expect(tables).toHaveLength(2);
    const [details, nested] = tables;
    expect(within(details!).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["amount", "description", "posted"]);
    expect(within(details!).getAllByRole("row")).toHaveLength(3);
    expect(within(details!).getByRole("cell", { name: "12345678901234567890.00" })).toBeInTheDocument();
    expect(within(details!).getByRole("cell", { name: "0" })).toBeInTheDocument();
    expect(within(details!).getByRole("cell", { name: "false" })).toBeInTheDocument();
    expect(within(details!).getByText("<img src=x onerror=alert(1)>")).toBeInTheDocument();
    expect(details!.querySelector("img")).toBeNull();
    expect(within(nested!).getByRole("cell", { name: "2" })).toBeInTheDocument();
    expect(screen.getByText("Test statement")).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
  });

  it("keeps saved fields that collide with internal row identity", () => {
    const data = { details: [{ _i: "saved-id", index: "saved-index", value: "saved-value", amount: "100.00" }] };
    renderWithProviders(<ReadonlyResult value={data} groups={null} lang="en" t={(key) => translate("en", key)} />);
    const table = document.querySelector<HTMLElement>(".ant-table table")!;
    expect(within(table).getByRole("cell", { name: "saved-id" })).toBeInTheDocument();
    expect(within(table).getByRole("cell", { name: "saved-index" })).toBeInTheDocument();
    expect(within(table).getByRole("cell", { name: "saved-value" })).toBeInTheDocument();
    expect(data).toEqual({ details: [{ _i: "saved-id", index: "saved-index", value: "saved-value", amount: "100.00" }] });
  });

  it("does not treat empty, primitive or mixed arrays as detail tables", () => {
    const data = { empty: [], tags: ["one", "two"], amounts: [0, false], mixed: [{ note: "object" }, "text"], absent: null };
    renderWithProviders(<ReadonlyResult value={data} groups={null} lang="en" t={(key) => translate("en", key)} />);
    expect(document.querySelector(".ant-table")).toBeNull();
    expect(screen.getByText("one, two")).toBeInTheDocument();
    expect(screen.getByText("0, false")).toBeInTheDocument();
    expect(screen.getByText('{"note":"object"}, text')).toBeInTheDocument();
    expect(screen.getByText("empty")).toBeInTheDocument();
    expect(screen.getByText("absent")).toBeInTheDocument();
  });
});

describe("OCR original text fallback (FR-OCR-026)", () => {
  beforeEach(() => useLanguage.getState().setLang("en"));
  afterEach(() => useLanguage.getState().setLang("en"));
  const original = "ภาษาไทย 中文 English\n12345678901234567890.00\n  unchanged  ";

  it.each(["en", "th", "zh"] as const)("%s explains fallback, preserves page order and multiline edits", async (lang) => {
    useLanguage.getState().setLang(lang);
    const tr = (key: MessageKey, vars?: Record<string, string | number>) => translate(lang, key, vars);
    const data = { ocr_text: { page_1: original, page_2: "", page_3: "last\npage" } };
    const view = renderWithProviders(<Harness initial={data} groups={null} />);
    expect(screen.getByText(tr("ocr.rawTitle"))).toBeInTheDocument();
    expect(screen.getByText(tr("ocr.rawNote"))).toBeInTheDocument();
    const inputs = screen.getAllByRole("textbox");
    expect(inputs.map((el) => (el as HTMLTextAreaElement).value)).toEqual([original, "", "last\npage"]);
    expect(inputs.every((el) => el.tagName === "TEXTAREA")).toBe(true);
    expect(screen.getByText(tr("ocr.rawEmptyPage"))).toBeInTheDocument();
    fireEvent.change(inputs[0]!, { target: { value: `${original}\nnew line` } });
    expect(current()).toEqual({ ocr_text: { ...data.ocr_text, page_1: `${original}\nnew line` } });
    view.unmount();
    const locked = renderWithProviders(<Harness initial={data} groups={null} editable={false} />);
    expect(screen.getByLabelText(tr("ocr.rawPage", { n: 1 })).textContent).toBe(original);
    expect(screen.queryByRole("textbox")).toBeNull();
    locked.unmount();
    renderWithProviders(<ReadonlyResult value={data} groups={null} lang={lang} t={tr} />);
    expect(screen.getByText(tr("ocr.rawNote"))).toBeInTheDocument();
    const page = screen.getByLabelText(tr("ocr.rawPage", { n: 1 }));
    expect(page.textContent).toBe(original);
    expect(page).toHaveStyle({ whiteSpace: "pre-wrap", overflowWrap: "anywhere" });
    expect(screen.getByText(tr("ocr.rawEmptyPage"))).toBeInTheDocument();
  });

  it.each<Json>([{ ocr_text: {} }, { ocr_text: { page_1: "", page_2: " \n " } }])("clearly reports no readable text: %j", (data) => {
    const tr = (key: MessageKey) => translate("en", key);
    const view = renderWithProviders(<Harness initial={data} groups={null} />);
    expect(screen.getByText(tr("ocr.rawEmpty"))).toBeInTheDocument();
    expect(current()).toEqual(data);
    view.unmount();
    renderWithProviders(<ReadonlyResult value={data} groups={null} lang="en" t={tr} />);
    expect(screen.getByText(tr("ocr.rawEmpty"))).toBeInTheDocument();
  });

  it.each<Json>([
    { ocr_text: { page_1: "normal" }, seller: "A" },
    { ocr_text: { notes: "normal" } },
    { ocr_text: { page_1: 12 } },
    { ocr_text: "normal" },
  ])("does not mistake ordinary fields for fallback: %j", (data) => {
    const tr = (key: MessageKey) => translate("en", key);
    const view = renderWithProviders(<Harness initial={data} groups={null} />);
    expect(screen.queryByText(tr("ocr.rawNote"))).toBeNull();
    // Ignore Ant Design's aria-hidden textarea used to measure autoSize, outside the rendered fields.
    expect(screen.getAllByRole("textbox").every((el) => el.tagName === "INPUT")).toBe(true);
    view.unmount();
    renderWithProviders(<ReadonlyResult value={data} groups={null} lang="en" t={tr} />);
    expect(screen.queryByText(tr("ocr.rawNote"))).toBeNull();
  });

  it("does not change a template with an ocr_text group", () => {
    const groups: Group[] = [{ key: "ocr_text", name: "Template", items: [{ kind: "field", key: "page_1", name: "Original" }] }];
    const data = { ocr_text: { page_1: original } };
    const tr = (key: MessageKey) => translate("en", key);
    const view = renderWithProviders(<Harness initial={data} groups={groups} />);
    expect(screen.queryByText(tr("ocr.rawNote"))).toBeNull();
    expect(screen.getByRole("textbox", { name: "Original" }).tagName).toBe("INPUT");
    view.unmount();
    renderWithProviders(<ReadonlyResult value={data} groups={groups} lang="en" t={tr} />);
    expect(screen.queryByText(tr("ocr.rawNote"))).toBeNull();
    expect(screen.getByText("Template")).toBeInTheDocument();
  });

  it("read-only generic values from real JSON keep safe integers, exact strings and false (025-05)", () => {
    const data = JSON.parse('{"safe":9007199254740991,"negative":-9007199254740991,"big":"12345678901234567890","group":{"outside":"-9007199254740992","zero":0,"flag":false,"items":[{"large":"-12345678901234567890","positive":"9007199254740992"}]}}');
    renderWithProviders(<ReadonlyResult value={data} groups={null} lang="en" t={(key) => translate("en", key)} />);
    for (const text of ["9007199254740991", "-9007199254740991", "12345678901234567890", "-9007199254740992", "0", "false", "-12345678901234567890", "9007199254740992"]) {
      expect(screen.getByText(text)).toBeInTheDocument();
    }
  });
});

describe("upload queue", () => {
  it("rejects a txt before upload", async () => {
    const api = mockApi({});
    const { result } = renderHook(() => useUploadQueue(() => {}));
    act(() => result.current.start([new File(["x"], "notes.txt", { type: "text/plain" })]));
    await waitFor(() => expect(result.current.items[0]?.status).toBe("failed"));
    expect(api.count("POST /api/v1/uploads")).toBe(0);
  });

  it("uploads a png through create, content and complete", async () => {
    const api = mockApi({
      "POST /api/v1/uploads": () => json(201, { id: "f1", file_name: "a.png", status: "UPLOADING" }),
      "PUT /api/v1/uploads/f1/content": () => json(204, null),
      "POST /api/v1/uploads/f1/complete": () => json(200, { id: "f1", file_name: "a.png", status: "READY" }),
    });
    let done = 0;
    const { result } = renderHook(() => useUploadQueue(() => (done += 1)));
    act(() => result.current.start([new File(["x"], "a.png", { type: "image/png" })]));
    await waitFor(() => expect(result.current.items[0]?.status).toBe("uploaded"));
    expect(api.count("POST /api/v1/uploads/f1/complete")).toBe(1);
    expect(done).toBeGreaterThan(0);
  });
});
