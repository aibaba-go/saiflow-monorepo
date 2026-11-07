import { act, renderHook, screen, waitFor, within } from "@testing-library/react";
import userEventLib from "@testing-library/user-event";
import { useState } from "react";
import { describe, expect, it } from "vitest";

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

function Harness({ initial, groups = GROUPS, missing = [] }: { initial: Json; groups?: Group[] | null; missing?: string[] }) {
  const [value, setValue] = useState<Json>(initial);
  return (
    <>
      <EditableResult
        value={value}
        groups={groups}
        missing={new Set(missing)}
        warnings={new Set()}
        amountIssues={new Map()}
        editable
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
