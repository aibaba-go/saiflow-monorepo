import {
  CODE_PATTERN,
  COLUMN_ROLES,
  FIELD_ROLES,
  FIELD_TYPES,
  KEY_PATTERN,
  NAME_LANGS,
  TEMPLATE_LIMITS,
  type TemplatePathError,
} from "./types";

/**
 * Quick client-side check mirroring `app/ocr/templates/schema.py` (structure, patterns, lengths,
 * uniqueness and the 20 / 200 / 10 limits). The server stays authoritative; messages are English.
 */

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);

const TEMPLATE_KEYS = ["code", "name", "names", "description", "groups"];
const GROUP_KEYS = ["key", "name", "names", "description", "items"];
const FIELD_KEYS = ["kind", "key", "name", "names", "description", "type", "required", "primary", "role"];
const TABLE_KEYS = ["kind", "key", "name", "names", "description", "columns"];
const COLUMN_KEYS = ["key", "name", "names", "description", "type", "required", "role"];

export interface TemplateCounts {
  groups: number;
  fieldsAndColumns: number;
  tables: number;
}

/** Counts used against the limits: groups, fields + table columns, tables. */
export function countTemplate(value: unknown): TemplateCounts {
  const counts: TemplateCounts = { groups: 0, fieldsAndColumns: 0, tables: 0 };
  if (!isObj(value) || !Array.isArray(value.groups)) return counts;
  counts.groups = value.groups.length;
  for (const g of value.groups) {
    if (!isObj(g) || !Array.isArray(g.items)) continue;
    for (const item of g.items) {
      if (!isObj(item)) continue;
      if (item.kind === "table") {
        counts.tables += 1;
        if (Array.isArray(item.columns)) counts.fieldsAndColumns += item.columns.length;
      } else {
        counts.fieldsAndColumns += 1;
      }
    }
  }
  return counts;
}

export function validateTemplateClient(value: unknown): TemplatePathError[] {
  const errors: TemplatePathError[] = [];
  const add = (path: string, message: string) => errors.push({ path, message });

  const extra = (obj: Obj, allowed: string[], base: string, ignoreUnderscore = false) => {
    for (const k of Object.keys(obj)) {
      if (allowed.includes(k)) continue;
      if (ignoreUnderscore && k.startsWith("_")) continue;
      add(base ? `${base}.${k}` : k, "Extra inputs are not permitted");
    }
  };
  const missing = (obj: Obj, keys: string[], base: string) => {
    for (const k of keys) if (!(k in obj)) add(base ? `${base}.${k}` : k, "Field required");
  };
  const str = (v: unknown, path: string, opts: { min?: number; max?: number; pattern?: RegExp; strip?: boolean }) => {
    if (typeof v !== "string") {
      add(path, "Input should be a valid string");
      return;
    }
    const s = opts.strip ? v.trim() : v;
    if (opts.pattern && !opts.pattern.test(s)) {
      add(path, `String should match pattern '${opts.pattern.source}'`);
      return;
    }
    if (opts.min !== undefined && s.length < opts.min)
      add(path, `String should have at least ${opts.min} character${opts.min === 1 ? "" : "s"}`);
    if (opts.max !== undefined && s.length > opts.max) add(path, `String should have at most ${opts.max} characters`);
  };
  const name = (obj: Obj, base: string) => {
    if ("name" in obj) str(obj.name, `${base}name`, { min: 1, max: TEMPLATE_LIMITS.name, strip: true });
  };
  const names = (obj: Obj, base: string) => {
    if (!("names" in obj) || obj.names === null || obj.names === undefined) return;
    const path = `${base}names`;
    if (!isObj(obj.names)) {
      add(path, "Input should be an object");
      return;
    }
    extra(obj.names, [...NAME_LANGS], path);
    for (const lang of NAME_LANGS) {
      const v = obj.names[lang];
      if (v === null || v === undefined) continue;
      str(v, `${path}.${lang}`, { min: 1, max: TEMPLATE_LIMITS.name, strip: true });
    }
  };
  const description = (obj: Obj, base: string, max: number) => {
    if ("description" in obj) str(obj.description, `${base}description`, { max, strip: true });
  };
  const key = (obj: Obj, base: string) => {
    if ("key" in obj) str(obj.key, `${base}key`, { pattern: KEY_PATTERN });
  };
  const bool = (obj: Obj, k: string, base: string) => {
    if (k in obj && typeof obj[k] !== "boolean") add(`${base}${k}`, "Input should be a valid boolean");
  };
  const literal = (obj: Obj, k: string, base: string, allowed: readonly string[], nullable: boolean) => {
    if (!(k in obj)) return;
    const v = obj[k];
    if (nullable && v === null) return;
    if (typeof v !== "string" || !allowed.includes(v))
      add(`${base}${k}`, `Input should be ${allowed.map((a) => `'${a}'`).join(", ")}`);
  };
  const list = (obj: Obj, k: string, path: string, min: number, max?: number): unknown[] | null => {
    if (!(k in obj)) return null;
    const v = obj[k];
    if (!Array.isArray(v)) {
      add(path, "Input should be a valid list");
      return null;
    }
    if (v.length < min)
      add(path, `List should have at least ${min} item${min === 1 ? "" : "s"} after validation, not ${v.length}`);
    if (max !== undefined && v.length > max)
      add(path, `List should have at most ${max} items after validation, not ${v.length}`);
    return v;
  };

  if (!isObj(value)) {
    add("$", "Input should be an object");
    return errors;
  }
  missing(value, ["code", "name", "groups"], "");
  extra(value, TEMPLATE_KEYS, "", true);
  if ("code" in value) str(value.code, "code", { pattern: CODE_PATTERN });
  name(value, "");
  names(value, "");
  description(value, "", TEMPLATE_LIMITS.templateDescription);
  const groups = list(value, "groups", "groups", 1, TEMPLATE_LIMITS.groups) ?? [];

  const groupKeys = new Set<string>();
  groups.forEach((g, gi) => {
    const gp = `groups[${gi}]`;
    if (!isObj(g)) {
      add(gp, "Input should be an object");
      return;
    }
    missing(g, ["key", "name", "items"], gp);
    extra(g, GROUP_KEYS, gp);
    key(g, `${gp}.`);
    name(g, `${gp}.`);
    names(g, `${gp}.`);
    description(g, `${gp}.`, TEMPLATE_LIMITS.description);
    if (typeof g.key === "string") {
      if (groupKeys.has(g.key)) add(`${gp}.key`, `duplicate group key '${g.key}'`);
      groupKeys.add(g.key);
    }
    const items = list(g, "items", `${gp}.items`, 1) ?? [];
    const itemKeys = new Set<string>();
    items.forEach((item, ii) => {
      const ip = `${gp}.items[${ii}]`;
      if (!isObj(item)) {
        add(ip, "Input should be an object");
        return;
      }
      if (!("kind" in item)) {
        add(ip, "Unable to extract tag using discriminator 'kind'");
      } else if (item.kind !== "field" && item.kind !== "table") {
        add(ip, `Input tag '${String(item.kind)}' found using 'kind' does not match any of the expected tags: 'field', 'table'`);
      } else if (item.kind === "field") {
        missing(item, ["key", "name"], ip);
        extra(item, FIELD_KEYS, ip);
        key(item, `${ip}.`);
        name(item, `${ip}.`);
        names(item, `${ip}.`);
        description(item, `${ip}.`, TEMPLATE_LIMITS.description);
        literal(item, "type", `${ip}.`, FIELD_TYPES, false);
        bool(item, "required", `${ip}.`);
        bool(item, "primary", `${ip}.`);
        literal(item, "role", `${ip}.`, FIELD_ROLES, true);
      } else {
        missing(item, ["key", "name", "columns"], ip);
        extra(item, TABLE_KEYS, ip);
        key(item, `${ip}.`);
        name(item, `${ip}.`);
        names(item, `${ip}.`);
        description(item, `${ip}.`, TEMPLATE_LIMITS.description);
        const columns = list(item, "columns", `${ip}.columns`, 1) ?? [];
        const colKeys = new Set<string>();
        columns.forEach((col, ci) => {
          const cp = `${ip}.columns[${ci}]`;
          if (!isObj(col)) {
            add(cp, "Input should be an object");
            return;
          }
          missing(col, ["key", "name"], cp);
          extra(col, COLUMN_KEYS, cp);
          key(col, `${cp}.`);
          name(col, `${cp}.`);
          names(col, `${cp}.`);
          description(col, `${cp}.`, TEMPLATE_LIMITS.description);
          literal(col, "type", `${cp}.`, FIELD_TYPES, false);
          bool(col, "required", `${cp}.`);
          literal(col, "role", `${cp}.`, COLUMN_ROLES, true);
          if (typeof col.key === "string") {
            if (colKeys.has(col.key)) add(`${cp}.key`, `duplicate column key '${col.key}' in table`);
            colKeys.add(col.key);
          }
        });
      }
      if (typeof item.key === "string") {
        if (itemKeys.has(item.key)) add(`${ip}.key`, `duplicate item key '${item.key}' in group`);
        itemKeys.add(item.key);
      }
    });
  });

  const counts = countTemplate(value);
  if (counts.fieldsAndColumns > TEMPLATE_LIMITS.fieldsAndColumns)
    add("groups", `fields and columns total ${counts.fieldsAndColumns} exceeds ${TEMPLATE_LIMITS.fieldsAndColumns}`);
  if (counts.tables > TEMPLATE_LIMITS.tables)
    add("groups", `tables total ${counts.tables} exceeds ${TEMPLATE_LIMITS.tables}`);
  return errors;
}
