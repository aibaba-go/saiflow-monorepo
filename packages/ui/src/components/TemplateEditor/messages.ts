import { CODE_PATTERN, KEY_PATTERN } from "./types";

/**
 * Wording for the path errors the editor shows. Server and client checks speak the same
 * pydantic-style English (`app/ocr/templates/schema.py`, `validate.ts`); the editor turns the
 * known messages into these texts and shows any other message as it came.
 */
export interface TemplateErrorLabels {
  codePattern: string;
  keyPattern: string;
  pattern: string;
  empty: string;
  maxLength: (n: number) => string;
  listMin: (n: number) => string;
  needGroup: string;
  needItem: string;
  needColumn: string;
  listMax: (n: number) => string;
  missing: string;
  extra: string;
  invalid: string;
  duplicateGroup: (key: string) => string;
  duplicateItem: (key: string) => string;
  duplicateColumn: (key: string) => string;
  fieldsTotal: (total: number, max: number) => string;
  tablesTotal: (total: number, max: number) => string;
  nothingToActivate: string;
}

export const DEFAULT_TEMPLATE_ERROR_LABELS: TemplateErrorLabels = {
  codePattern: "Use 1–64 lowercase letters, digits, dot, underscore or hyphen, starting with a letter or digit",
  keyPattern: "Use 1–64 lowercase letters, digits or underscore, starting with a letter",
  pattern: "The format is not valid",
  empty: "Cannot be empty",
  maxLength: (n) => `At most ${n} characters`,
  listMin: (n) => `Add at least ${n}`,
  needGroup: "Add at least one group",
  needItem: "Add at least one field or table to this group",
  needColumn: "Add at least one column to this table",
  listMax: (n) => `At most ${n} allowed`,
  missing: "Required",
  extra: "Not a template attribute",
  invalid: "The value is not valid",
  duplicateGroup: (key) => `Group key "${key}" is used more than once`,
  duplicateItem: (key) => `Key "${key}" is used more than once in this group`,
  duplicateColumn: (key) => `Column key "${key}" is used more than once in this table`,
  fieldsTotal: (total, max) => `${total} fields and columns; at most ${max} allowed`,
  tablesTotal: (total, max) => `${total} tables; at most ${max} allowed`,
  nothingToActivate: "There is no draft to activate",
};

type Rule = [RegExp, (m: RegExpMatchArray, l: TemplateErrorLabels, path: string) => string];

/** An empty list says which list it is: groups, a group's items or a table's columns. */
function listMin(n: number, l: TemplateErrorLabels, path: string): string {
  if (n === 1 && path === "groups") return l.needGroup;
  if (n === 1 && path.endsWith(".items")) return l.needItem;
  if (n === 1 && path.endsWith(".columns")) return l.needColumn;
  return l.listMin(n);
}

const RULES: Rule[] = [
  [
    /^String should match pattern '(.*)'$/,
    (m, l) => (m[1] === CODE_PATTERN.source ? l.codePattern : m[1] === KEY_PATTERN.source ? l.keyPattern : l.pattern),
  ],
  [/^String should have at least 1 character$/, (_, l) => l.empty],
  [/^String should have at most (\d+) characters?$/, (m, l) => l.maxLength(Number(m[1]))],
  [/^List should have at least (\d+) items? after validation/, (m, l, path) => listMin(Number(m[1]), l, path)],
  [/^List should have at most (\d+) items? after validation/, (m, l) => l.listMax(Number(m[1]))],
  [/^Field required$/, (_, l) => l.missing],
  [/^Extra inputs are not permitted$/, (_, l) => l.extra],
  [/^duplicate group key '(.*)'$/, (m, l) => l.duplicateGroup(m[1] ?? "")],
  [/^duplicate item key '(.*)' in group$/, (m, l) => l.duplicateItem(m[1] ?? "")],
  [/^duplicate column key '(.*)' in table$/, (m, l) => l.duplicateColumn(m[1] ?? "")],
  [/^fields and columns total (\d+) exceeds (\d+)$/, (m, l) => l.fieldsTotal(Number(m[1]), Number(m[2]))],
  [/^tables total (\d+) exceeds (\d+)$/, (m, l) => l.tablesTotal(Number(m[1]), Number(m[2]))],
  [/^nothing to activate$/, (_, l) => l.nothingToActivate],
  [/^(Input should be|Input tag|Unable to extract tag)/, (_, l) => l.invalid],
];

/** The localized text of one path error; an unknown message is returned unchanged. */
export function localizeTemplateError(message: string, labels: TemplateErrorLabels, path = ""): string {
  for (const [re, text] of RULES) {
    const m = message.match(re);
    if (m) return text(m, labels, path);
  }
  return message;
}
