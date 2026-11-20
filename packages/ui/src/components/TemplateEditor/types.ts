/**
 * Template content shapes (services/api/app/ocr/templates/schema.py `TemplateDef`, FR-TEMPLATE-001/003–005).
 * A draft may be incomplete, so editor input is read defensively.
 */

export const FIELD_TYPES = ["string", "integer", "decimal", "amount", "date"] as const;
export type FieldType = (typeof FIELD_TYPES)[number];

export const FIELD_ROLES = ["lines_total", "discount", "base", "tax", "grand_total"] as const;
export type FieldRole = (typeof FIELD_ROLES)[number];

export const COLUMN_ROLES = ["quantity", "unit_price", "line_discount", "line_base", "line_tax", "line_total"] as const;
export type ColumnRole = (typeof COLUMN_ROLES)[number];

export const NAME_LANGS = ["en", "th", "zh"] as const;
export type NameLang = (typeof NAME_LANGS)[number];

export const TEMPLATE_LIMITS = {
  groups: 20,
  fieldsAndColumns: 200,
  tables: 10,
  name: 100,
  description: 500,
  templateDescription: 1000,
} as const;

export const KEY_PATTERN = /^[a-z][a-z0-9_]{0,63}$/;
export const CODE_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;

export type Names = Partial<Record<NameLang, string | null>>;

export interface TemplateColumn {
  key: string;
  name: string;
  names?: Names | null;
  description?: string;
  type?: FieldType;
  required?: boolean;
  role?: ColumnRole | null;
}

export interface TemplateField {
  kind: "field";
  key: string;
  name: string;
  names?: Names | null;
  description?: string;
  type?: FieldType;
  required?: boolean;
  primary?: boolean;
  role?: FieldRole | null;
}

export interface TemplateTable {
  kind: "table";
  key: string;
  name: string;
  names?: Names | null;
  description?: string;
  columns: TemplateColumn[];
}

export type TemplateItem = TemplateField | TemplateTable;

export interface TemplateGroup {
  key: string;
  name: string;
  names?: Names | null;
  description?: string;
  items: TemplateItem[];
}

export interface TemplateContent {
  code: string;
  name: string;
  names?: Names | null;
  description?: string;
  groups: TemplateGroup[];
}

/** Server/client validation error: path like `groups[1].items[0].columns[2].type`. */
export interface TemplatePathError {
  path: string;
  message: string;
}

export type ConfirmAttr = "required" | "primary" | "role";

/** A sample-generated suggestion that a person must confirm (FR-TEMPLATE-008/014). */
export interface PendingConfirmation {
  /** Item or column path, e.g. `groups[0].items[2]` or `groups[0].items[1].columns[3]`. */
  path: string;
  attr: ConfirmAttr | string;
  value: unknown;
}

/**
 * Sample values from a sample candidate: `"<group>.<item>"` → value; `"<group>.<table>"` → rows,
 * each row an array by column index or an object by column key.
 */
export type SampleValues = Record<
  string,
  string | number | null | ReadonlyArray<ReadonlyArray<string | number | null> | Record<string, string | number | null>>
>;
