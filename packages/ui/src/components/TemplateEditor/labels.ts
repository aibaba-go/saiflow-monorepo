import { DEFAULT_TEMPLATE_ERROR_LABELS, type TemplateErrorLabels } from "./messages";
import type { ColumnRole, FieldRole, FieldType, NameLang } from "./types";

/** Texts of TemplateEditor; apps pass their translations (English defaults). */
export interface TemplateEditorLabels {
  templateSection: string;
  code: string;
  name: string;
  description: string;
  names: string;
  nameLang: Record<NameLang, string>;
  key: string;
  type: string;
  required: string;
  primary: string;
  role: string;
  noRole: string;
  sampleValue: string;
  more: string;
  less: string;
  group: (n: number) => string;
  field: (n: number) => string;
  table: (n: number) => string;
  column: (n: number) => string;
  columns: string;
  addGroup: string;
  addField: string;
  addTable: string;
  addColumn: string;
  remove: string;
  removeGroup: string;
  removeTable: string;
  removeConfirm: string;
  confirmOk: string;
  cancel: string;
  moveUp: string;
  moveDown: string;
  types: Record<FieldType, string>;
  fieldRoles: Record<FieldRole, string>;
  columnRoles: Record<ColumnRole, string>;
  countGroups: string;
  countFields: string;
  countTables: string;
  limitReached: string;
  errorSummary: (n: number) => string;
  /** Shown beside required/primary/role while a sample suggestion awaits a person. */
  toConfirm: string;
  pendingSummary: (n: number) => string;
  suggested: (attr: string, value: string) => string;
  accept: string;
  reject: string;
  yes: string;
  no: string;
  emptyGroups: string;
  /** Wording of the path errors (server and client checks speak English). */
  errors: TemplateErrorLabels;
}

export const DEFAULT_TEMPLATE_EDITOR_LABELS: TemplateEditorLabels = {
  templateSection: "Template",
  code: "Code",
  name: "Name",
  description: "Description",
  names: "Names by language",
  nameLang: { en: "English", th: "Thai", zh: "Chinese" },
  key: "Key",
  type: "Type",
  required: "Required",
  primary: "Primary",
  role: "Role",
  noRole: "No role",
  sampleValue: "Sample value",
  more: "More",
  less: "Less",
  group: (n) => `Group ${n}`,
  field: (n) => `Field ${n}`,
  table: (n) => `Table ${n}`,
  column: (n) => `Column ${n}`,
  columns: "Columns",
  addGroup: "Add group",
  addField: "Add field",
  addTable: "Add table",
  addColumn: "Add column",
  remove: "Remove",
  removeGroup: "Remove group",
  removeTable: "Remove table",
  removeConfirm: "Remove it with everything inside?",
  confirmOk: "Remove",
  cancel: "Cancel",
  moveUp: "Move up",
  moveDown: "Move down",
  types: { string: "Text", integer: "Integer", decimal: "Decimal", amount: "Amount", date: "Date" },
  fieldRoles: {
    lines_total: "Lines total",
    discount: "Discount",
    base: "Base amount",
    tax: "Tax",
    grand_total: "Grand total",
  },
  columnRoles: {
    quantity: "Quantity",
    unit_price: "Unit price",
    line_discount: "Line discount",
    line_base: "Line base",
    line_tax: "Line tax",
    line_total: "Line total",
  },
  countGroups: "Groups",
  countFields: "Fields and columns",
  countTables: "Tables",
  limitReached: "Limit reached",
  errorSummary: (n) => `${n} problem${n === 1 ? "" : "s"} to fix before activation`,
  toConfirm: "To confirm",
  pendingSummary: (n) => `${n} suggestion${n === 1 ? "" : "s"} from the sample still need${n === 1 ? "s" : ""} your confirmation`,
  suggested: (attr, value) => `Suggested ${attr}: ${value}`,
  accept: "Accept",
  reject: "Reject",
  yes: "Yes",
  no: "No",
  emptyGroups: "No groups yet. Add a group to start.",
  errors: DEFAULT_TEMPLATE_ERROR_LABELS,
};

export function mergeTemplateEditorLabels(labels?: Partial<TemplateEditorLabels>): TemplateEditorLabels {
  if (!labels) return DEFAULT_TEMPLATE_EDITOR_LABELS;
  const d = DEFAULT_TEMPLATE_EDITOR_LABELS;
  return {
    ...d,
    ...labels,
    nameLang: { ...d.nameLang, ...labels.nameLang },
    types: { ...d.types, ...labels.types },
    fieldRoles: { ...d.fieldRoles, ...labels.fieldRoles },
    columnRoles: { ...d.columnRoles, ...labels.columnRoles },
    errors: { ...d.errors, ...labels.errors },
  };
}
