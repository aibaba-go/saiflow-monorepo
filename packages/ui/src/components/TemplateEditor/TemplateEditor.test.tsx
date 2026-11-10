import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { DEFAULT_TEMPLATE_ERROR_LABELS, TemplateEditor, type TemplateEditorProps } from "./index";
import type { TemplateColumn, TemplateContent, TemplateField, TemplateTable } from "./types";

// antd renders slowly in jsdom, more so while other workspace suites share the CPU.
vi.setConfig({ testTimeout: 60_000 });

const field = (key: string, name: string, extra: Partial<TemplateField> = {}): TemplateField => ({
  kind: "field",
  key,
  name,
  description: "",
  type: "string",
  required: false,
  primary: false,
  role: null,
  ...extra,
});
const column = (key: string, name: string): TemplateColumn => ({
  key,
  name,
  description: "",
  type: "string",
  required: false,
  role: null,
});
const table = (key: string, name: string, columns: TemplateColumn[]): TemplateTable => ({
  kind: "table",
  key,
  name,
  description: "",
  columns,
});

const base = (): TemplateContent => ({
  code: "invoice",
  name: "Invoice",
  description: "",
  groups: [
    {
      key: "header",
      name: "Header",
      description: "",
      items: [field("number", "Number"), field("total", "Total"), table("lines", "Lines", [column("qty", "Qty"), column("price", "Price")])],
    },
  ],
});

type HarnessProps = Omit<TemplateEditorProps, "value" | "onChange"> & {
  initial: TemplateContent;
  onChange?: (v: TemplateContent) => void;
};

function Harness({ initial, onChange, ...rest }: HarnessProps) {
  const [value, setValue] = useState(initial);
  return (
    <TemplateEditor
      {...rest}
      value={value}
      onChange={(next) => {
        onChange?.(next);
        setValue(next);
      }}
    />
  );
}

function setup(props: Partial<HarnessProps> = {}) {
  const onChange = vi.fn<(v: TemplateContent) => void>();
  const user = userEvent.setup();
  render(<Harness initial={props.initial ?? base()} {...props} onChange={onChange} />);
  const last = () => onChange.mock.calls.at(-1)![0];
  return { user, onChange, last };
}

const itemKeys = (v: TemplateContent, gi = 0) => v.groups[gi]!.items.map((i) => i.key);
const columnKeys = (v: TemplateContent) => (v.groups[0]!.items[2] as TemplateTable).columns.map((c) => c.key);

describe("TemplateEditor structure", () => {
  it("adds groups, fields, tables and columns with schema defaults", async () => {
    const { user, last } = setup();
    await user.click(screen.getByRole("button", { name: "Add group" }));
    expect(last().groups).toHaveLength(2);
    expect(last().groups[1]).toEqual({ key: "", name: "", description: "", items: [field("", "")] });

    const g1 = screen.getByRole("region", { name: "Group 1" });
    await user.click(within(g1).getByRole("button", { name: "Add field" }));
    expect(itemKeys(last())).toEqual(["number", "total", "lines", ""]);

    await user.click(within(g1).getByRole("button", { name: "Add table" }));
    const added = last().groups[0]!.items[4] as TemplateTable;
    expect(added.kind).toBe("table");
    expect(added.columns).toEqual([column("", "")]);

    await user.click(within(screen.getByRole("group", { name: "Lines" })).getByRole("button", { name: "Add column" }));
    expect(columnKeys(last())).toEqual(["qty", "price", ""]);
    // New columns never carry `primary`.
    expect(Object.keys((last().groups[0]!.items[2] as TemplateTable).columns[2]!)).not.toContain("primary");
  });

  it("removes fields, columns, tables and groups (containers after confirmation)", async () => {
    const { user, last } = setup();
    await user.click(screen.getByRole("button", { name: "Remove: Total" }));
    expect(itemKeys(last())).toEqual(["number", "lines"]);

    await user.click(screen.getByRole("button", { name: "Remove: Qty" }));
    expect((last().groups[0]!.items[1] as TemplateTable).columns.map((c) => c.key)).toEqual(["price"]);

    await user.click(screen.getByRole("button", { name: "Remove table: Lines" }));
    await user.click(await screen.findByRole("button", { name: "Remove" }));
    expect(itemKeys(last())).toEqual(["number"]);

    await user.click(screen.getByRole("button", { name: "Remove group: Header" }));
    const ok = await screen.findAllByRole("button", { name: "Remove" });
    await user.click(ok.at(-1)!);
    expect(last().groups).toEqual([]);
    expect(screen.getByText("No groups yet. Add a group to start.")).toBeInTheDocument();
  });

  it("reorders with move up / down buttons, keeps focus and reports path remaps", async () => {
    const onPathsRemap = vi.fn();
    const { user, last } = setup({ onPathsRemap });
    const up = screen.getByRole("button", { name: "Move up: Number" });
    expect(up).toBeDisabled();
    await user.click(screen.getByRole("button", { name: "Move down: Number" }));
    expect(itemKeys(last())).toEqual(["total", "number", "lines"]);
    const remap = onPathsRemap.mock.calls.at(-1)![0] as (p: string) => string | null;
    expect(remap("groups[0].items[0].key")).toBe("groups[0].items[1].key");
    expect(remap("groups[0].items[1]")).toBe("groups[0].items[0]");
    expect(remap("groups[0].items[2].columns[0]")).toBe("groups[0].items[2].columns[0]");
    expect(screen.getByRole("button", { name: "Move down: Number" })).toHaveFocus();

    await user.click(screen.getByRole("button", { name: "Move up: Price" }));
    expect((last().groups[0]!.items[2] as TemplateTable).columns.map((c) => c.key)).toEqual(["price", "qty"]);

    await user.click(screen.getByRole("button", { name: "Add group" }));
    await user.click(screen.getByRole("button", { name: "Move up: Group 2" }));
    expect(last().groups.map((g) => g.key)).toEqual(["", "header"]);
  });

  it("suggests a key from the name while the key is empty", async () => {
    const { user, last } = setup({ initial: { ...base(), groups: [{ key: "g", name: "G", items: [field("", "")] }] } });
    const row = screen.getByRole("group", { name: "Field 1" });
    await user.type(within(row).getByRole("textbox", { name: "Name" }), "Due Date");
    expect(last().groups[0]!.items[0]).toMatchObject({ key: "due_date", name: "Due Date" });
    // Internal row ids never enter the value.
    expect(Object.keys(last().groups[0]!.items[0]!).sort()).toEqual(
      ["description", "key", "kind", "name", "primary", "required", "role", "type"].sort(),
    );
  });

  it("shows names en/th/zh in an expandable area", async () => {
    const { user, last } = setup();
    const row = screen.getByRole("group", { name: "Number" });
    const more = within(row).getByRole("button", { name: "More" });
    expect(more).toHaveAttribute("aria-expanded", "false");
    await user.click(more);
    await user.type(within(row).getByRole("textbox", { name: "Names by language: Thai" }), "เลขที่");
    expect(last().groups[0]!.items[0]!.names).toEqual({ th: "เลขที่" });
  });
});

describe("TemplateEditor columns", () => {
  it("has no primary option on table columns", () => {
    setup();
    const fieldRow = screen.getByRole("group", { name: "Number" });
    expect(within(fieldRow).getByRole("checkbox", { name: "Primary" })).toBeInTheDocument();
    const col = screen.getByRole("listitem", { name: "Qty" });
    expect(within(col).getByRole("checkbox", { name: "Required" })).toBeInTheDocument();
    expect(within(col).queryByRole("checkbox", { name: "Primary" })).toBeNull();
  });
});

describe("TemplateEditor limits", () => {
  it("shows counts and disables add group at 20 groups", () => {
    const groups = Array.from({ length: 20 }, (_, i) => ({ key: `g${i}`, name: `G${i}`, items: [field("f", "F")] }));
    setup({ initial: { ...base(), groups } });
    expect(screen.getByText("Groups 20/20")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add group" })).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "Add field" })[0]).toBeEnabled();
    expect(screen.getByText("Limit reached")).toBeInTheDocument();
  });

  it("disables add table at 10 tables", () => {
    const items = Array.from({ length: 10 }, (_, i) => table(`t${i}`, `T${i}`, [column("c", "C")]));
    setup({ initial: { ...base(), groups: [{ key: "g", name: "G", items }] } });
    expect(screen.getByText("Tables 10/10")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Add table" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Add field" })).toBeEnabled();
  });

  it("disables every add at 200 fields and columns", () => {
    const items = [field("f", "F"), table("t", "T", Array.from({ length: 199 }, (_, i) => column(`c${i}`, `C${i}`)))];
    setup({ initial: { ...base(), groups: [{ key: "g", name: "G", items }] } });
    expect(screen.getByText("Fields and columns 200/200")).toBeInTheDocument();
    // getByRole over ~200 rows is very slow in jsdom; the button text is enough here
    for (const name of ["Add group", "Add field", "Add table", "Add column"])
      expect(screen.getByText(name, { selector: "button, button *" }).closest("button")).toBeDisabled();
  }, 120_000); // ~200 antd rows render slowly in jsdom
});

describe("TemplateEditor errors", () => {
  it("shows each error beside its input and focuses it from the summary", async () => {
    const errors = [
      { path: "groups[0].items[0].key", message: "duplicate item key 'number' in group" },
      { path: "code", message: "String should match pattern" },
      { path: "groups", message: "tables total 11 exceeds 10" },
    ];
    const { user } = setup({ errors });
    const keyInput = within(screen.getByRole("group", { name: "Number" })).getByRole("textbox", { name: "Key" });
    expect(keyInput).toHaveAttribute("aria-invalid", "true");
    expect(keyInput).toHaveAccessibleDescription('Key "number" is used more than once in this group');
    expect(screen.getAllByRole("textbox", { name: "Code" })[0]).toHaveAccessibleDescription("String should match pattern");

    expect(screen.getByText("3 problems to fix before activation")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Header › Number › Key" }));
    expect(keyInput).toHaveFocus();
    // Errors without an input are shown under the header.
    expect(within(screen.getByRole("region", { name: "Template" })).getByText("11 tables; at most 10 allowed")).toBeInTheDocument();
  });

  it("words known server messages with the app's labels and keeps unknown ones", () => {
    setup({
      errors: [
        { path: "code", message: "String should match pattern '^[a-z0-9][a-z0-9._-]{0,63}$'" },
        { path: "name", message: "String should have at least 1 character" },
        { path: "description", message: "something new" },
      ],
      labels: { errors: { ...DEFAULT_TEMPLATE_ERROR_LABELS, empty: "不能为空" } },
    });
    const header = screen.getByRole("region", { name: "Template" });
    expect(within(header).getAllByRole("textbox", { name: "Code" })[0]).toHaveAccessibleDescription(
      DEFAULT_TEMPLATE_ERROR_LABELS.codePattern,
    );
    expect(within(header).getAllByRole("textbox", { name: "Name" })[0]).toHaveAccessibleDescription("不能为空");
    expect(screen.getByText(": something new")).toBeInTheDocument();
  });

  it("opens the details area when a description or name has an error", () => {
    setup({ errors: [{ path: "groups[0].items[1].names.zh", message: "too long" }] });
    const row = screen.getByRole("group", { name: "Total" });
    expect(within(row).getByRole("button", { name: "Less" })).toHaveAttribute("aria-expanded", "true");
    expect(within(row).getByRole("textbox", { name: "Names by language: Chinese" })).toHaveAccessibleDescription("too long");
  });
});

describe("TemplateEditor confirmations", () => {
  const pending = [
    { path: "groups[0].items[0]", attr: "required", value: true },
    { path: "groups[0].items[2].columns[0]", attr: "role", value: "quantity" },
  ];

  it("marks pending suggestions and accepts them", async () => {
    const onConfirm = vi.fn();
    const { user, last } = setup({ pendingConfirmations: pending, onConfirm });
    expect(screen.getByText("2 suggestions from the sample still need your confirmation")).toBeInTheDocument();
    const row = screen.getByRole("group", { name: "Number" });
    expect(within(row).getAllByText("To confirm").length).toBeGreaterThan(0);
    expect(within(row).getByText("Suggested Required: Yes")).toBeInTheDocument();
    await user.click(within(row).getByRole("button", { name: "Accept" }));
    expect(last().groups[0]!.items[0]).toMatchObject({ required: true });
    expect(onConfirm).toHaveBeenCalledWith("groups[0].items[0]", "required", true);
  });

  it("rejects suggestions and treats a manual different choice as a reject", async () => {
    const onConfirm = vi.fn();
    const initial = base();
    (initial.groups[0]!.items[2] as TemplateTable).columns[0]!.role = "quantity";
    const { user, last } = setup({ initial, pendingConfirmations: pending, onConfirm });
    const col = screen.getByRole("listitem", { name: "Qty" });
    expect(within(col).getByText("Suggested Role: Quantity")).toBeInTheDocument();
    await user.click(within(col).getByRole("button", { name: "Reject" }));
    expect((last().groups[0]!.items[2] as TemplateTable).columns[0]!.role).toBeNull();
    expect(onConfirm).toHaveBeenCalledWith("groups[0].items[2].columns[0]", "role", false);

    await user.click(within(screen.getByRole("group", { name: "Number" })).getByRole("checkbox", { name: "Required" }));
    expect(onConfirm).toHaveBeenLastCalledWith("groups[0].items[0]", "required", true);
  });

  it("accepts every suggestion at once after asking", async () => {
    const onConfirm = vi.fn();
    const { user, last } = setup({ pendingConfirmations: pending, onConfirm });
    await user.click(screen.getByRole("button", { name: "Accept all" }));
    await user.click(lastPopconfirmOk());
    expect(last().groups[0]!.items[0]).toMatchObject({ required: true });
    expect((last().groups[0]!.items[2] as TemplateTable).columns[0]!.role).toBe("quantity");
    expect(onConfirm).toHaveBeenCalledTimes(2);
    expect(onConfirm).toHaveBeenCalledWith("groups[0].items[0]", "required", true);
    expect(onConfirm).toHaveBeenCalledWith("groups[0].items[2].columns[0]", "role", true);
  });

  it("rejects every suggestion at once, clearing values still as suggested", async () => {
    const onConfirm = vi.fn();
    const initial = base();
    initial.groups[0]!.items[0] = field("number", "Number", { required: true });
    (initial.groups[0]!.items[2] as TemplateTable).columns[0]!.role = "quantity";
    const { user, last } = setup({ initial, pendingConfirmations: pending, onConfirm });
    await user.click(screen.getByRole("button", { name: "Reject all" }));
    await user.click(lastPopconfirmOk());
    expect(last().groups[0]!.items[0]).toMatchObject({ required: false });
    expect((last().groups[0]!.items[2] as TemplateTable).columns[0]!.role).toBeNull();
    expect(onConfirm).toHaveBeenCalledWith("groups[0].items[0]", "required", false);
    expect(onConfirm).toHaveBeenCalledWith("groups[0].items[2].columns[0]", "role", false);
  });
});

function lastPopconfirmOk(): HTMLElement {
  const pops = document.querySelectorAll<HTMLElement>(".ant-popconfirm");
  const pop = pops[pops.length - 1]!;
  return pop.querySelector<HTMLElement>(".ant-btn-primary")!;
}

describe("TemplateEditor readOnly", () => {
  it("shows the structure without editing controls", () => {
    setup({
      readOnly: true,
      pendingConfirmations: [{ path: "groups[0].items[0]", attr: "required", value: true }],
      sampleValues: { "header.number": "INV-001", "header.lines": [{ qty: "2" }, { qty: "3" }] },
    });
    expect(screen.queryByRole("button", { name: /^Add / })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Remove/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /^Move / })).toBeNull();
    expect(screen.queryByRole("button", { name: "Accept" })).toBeNull();
    const row = screen.getByRole("group", { name: "Number" });
    expect(within(row).getByRole("textbox", { name: "Key" })).toHaveAttribute("readonly");
    expect(within(row).getByRole("checkbox", { name: "Required" })).toBeDisabled();
    expect(within(row).getByText("INV-001")).toBeInTheDocument();
    expect(within(screen.getByRole("listitem", { name: "Qty" })).getByText("2 · 3")).toBeInTheDocument();
  });
});
