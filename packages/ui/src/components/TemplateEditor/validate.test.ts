import { countTemplate, validateTemplateClient } from "./validate";
import type { TemplateContent } from "./types";

const valid = (): TemplateContent => ({
  code: "invoice",
  name: "Invoice",
  description: "",
  groups: [
    {
      key: "header",
      name: "Header",
      description: "",
      items: [
        { kind: "field", key: "number", name: "Number", description: "", type: "string", required: true, primary: true, role: null },
        { kind: "field", key: "total", name: "Total", description: "", type: "amount", required: false, primary: false, role: "grand_total" },
        {
          kind: "table",
          key: "lines",
          name: "Lines",
          description: "",
          columns: [
            { key: "qty", name: "Qty", description: "", type: "decimal", required: false, role: "quantity" },
            { key: "amount", name: "Amount", description: "", type: "amount", required: false, role: "line_total" },
          ],
        },
      ],
    },
  ],
});

const paths = (v: unknown) => validateTemplateClient(v).map((e) => e.path);

describe("validateTemplateClient", () => {
  it("accepts a valid template and ignores _private keys at the top level", () => {
    expect(validateTemplateClient(valid())).toEqual([]);
    expect(validateTemplateClient({ ...valid(), _pending_confirmations: [] })).toEqual([]);
  });

  it("reports required, pattern and length errors with server-style paths", () => {
    const v = valid();
    v.code = "Bad Code";
    v.name = "   ";
    v.groups[0]!.key = "1bad";
    const errs = validateTemplateClient(v);
    expect(errs).toContainEqual({ path: "code", message: "String should match pattern '^[a-z0-9][a-z0-9._-]{0,63}$'" });
    expect(errs).toContainEqual({ path: "name", message: "String should have at least 1 character" });
    expect(errs.map((e) => e.path)).toContain("groups[0].key");
    expect(paths({ name: "x" })).toEqual(expect.arrayContaining(["code", "groups"]));
    expect(paths({ ...valid(), groups: [] })).toEqual(["groups"]);
  });

  it("rejects primary (and other extra keys) on table columns", () => {
    const v = valid() as unknown as { groups: { items: { columns?: Record<string, unknown>[] }[] }[] };
    v.groups[0]!.items[2]!.columns![0]!.primary = true;
    expect(validateTemplateClient(v)).toContainEqual({
      path: "groups[0].items[2].columns[0].primary",
      message: "Extra inputs are not permitted",
    });
  });

  it("checks literals, kinds and duplicate keys per level", () => {
    const v = valid() as unknown as { groups: { items: Record<string, unknown>[] }[] };
    v.groups[0]!.items[0]!.type = "money";
    v.groups[0]!.items[1]!.key = "number";
    v.groups[0]!.items.push({ kind: "chart", key: "c", name: "C" });
    const errs = paths(v);
    expect(errs).toContain("groups[0].items[0].type");
    expect(errs).toContain("groups[0].items[1].key");
    expect(errs).toContain("groups[0].items[3]");
    // Column role list differs from field roles.
    const w = valid() as unknown as { groups: { items: { columns?: Record<string, unknown>[] }[] }[] };
    w.groups[0]!.items[2]!.columns![0]!.role = "grand_total";
    expect(paths(w)).toEqual(["groups[0].items[2].columns[0].role"]);
  });

  it("enforces the 20 / 200 / 10 limits", () => {
    const g = valid().groups[0]!;
    const many = { ...valid(), groups: Array.from({ length: 21 }, (_, i) => ({ ...g, key: `g${i}` })) };
    expect(validateTemplateClient(many).some((e) => e.path === "groups" && /at most 20/.test(e.message))).toBe(true);

    const table = g.items[2]!;
    const tables = { ...valid(), groups: [{ ...g, items: Array.from({ length: 11 }, (_, i) => ({ ...table, key: `t${i}` })) }] };
    expect(validateTemplateClient(tables)).toContainEqual({ path: "groups", message: "tables total 11 exceeds 10" });

    const field = g.items[0]!;
    const fields = { ...valid(), groups: [{ ...g, items: Array.from({ length: 201 }, (_, i) => ({ ...field, key: `f${i}` })) }] };
    expect(validateTemplateClient(fields)).toContainEqual({ path: "groups", message: "fields and columns total 201 exceeds 200" });
    expect(countTemplate(valid())).toEqual({ groups: 1, fieldsAndColumns: 4, tables: 1 });
  });
});
