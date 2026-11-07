// Ported from apps/line-mini/src/features/scan/structured.ts (web-pc-ocr: copied, not shared).
/** Helpers for editing a result (main `structured.ts`): paths, labels and decimal text.
 * Amounts and numbers stay strings end to end, so no precision is lost (AC-FR-SYS-105-01). */
import type { Lang } from "../stores/language";

export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Obj = { [key: string]: Json };
export type Path = (string | number)[];

export interface Column {
  key: string;
  name: string;
  names?: Partial<Record<Lang, string>>;
  type?: string;
  required?: boolean;
}
export interface Item extends Column {
  kind: "field" | "table";
  columns?: Column[];
}
export interface Group {
  key: string;
  name: string;
  names?: Partial<Record<Lang, string>>;
  items: Item[];
}

export const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
export const isTable = (v: unknown): v is Obj[] => Array.isArray(v) && v.every(isObj);

/** The label in the UI language, else the template's default name (FR-SYS-105). */
export function label(item: { key: string; name?: string; names?: Partial<Record<Lang, string>> }, lang: Lang): string {
  return item.names?.[lang] || item.name || item.key;
}

/** The path the backend uses in missing_required: `group.key`, `group.table[1].col`. */
export function pathText(path: Path): string {
  return path.reduce<string>(
    (out, part) => (typeof part === "number" ? `${out}[${part}]` : out ? `${out}.${part}` : part),
    "",
  );
}

export function getAt(root: Json, path: Path): Json {
  let node: Json = root;
  for (const part of path) {
    if (node === null || typeof node !== "object") return null;
    node = (node as Record<string | number, Json>)[part] ?? null;
  }
  return node;
}

/** A copy of root with value at path; missing objects on the way are created. */
export function setAt(root: Json, path: Path, value: Json): Json {
  if (!path.length) return value;
  const head = path[0] as string | number;
  const rest = path.slice(1);
  if (typeof head === "number") {
    const list = Array.isArray(root) ? [...root] : [];
    list[head] = setAt(list[head] ?? null, rest, value);
    return list;
  }
  const obj = isObj(root) ? { ...root } : {};
  obj[head] = setAt(obj[head] ?? null, rest, value);
  return obj;
}

export function removeAt(root: Json, path: Path): Json {
  const parent = getAt(root, path.slice(0, -1));
  const last = path[path.length - 1];
  if (Array.isArray(parent) && typeof last === "number") {
    return setAt(root, path.slice(0, -1), parent.filter((_, i) => i !== last));
  }
  if (isObj(parent) && typeof last === "string") {
    const rest = { ...parent };
    delete rest[last];
    return setAt(root, path.slice(0, -1), rest);
  }
  return root;
}

const NUMERIC = new Set(["integer", "decimal", "amount"]);
const GROUPED = /^-?\d{1,3}(,\d{3})+(\.\d+)?$|^-?\d+(\.\d+)?$/;

/** Number fields keep the typed text; a thousands separator is dropped when the rest is a
 * plain decimal ("1,234.50" → "1234.50"). Anything else is kept as typed. */
export function cleanValue(text: string, type?: string): string {
  const trimmed = text.trim();
  if (type && NUMERIC.has(type) && GROUPED.test(trimmed)) return trimmed.replace(/,/g, "");
  return text;
}

export function asText(value: Json): string {
  if (value === null || value === undefined) return "";
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}
