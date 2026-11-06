import { useState } from "react";

import { useT } from "../../../i18n";
import { useLanguage } from "../../../stores/language";
import {
  asText,
  cleanValue,
  getAt,
  isObj,
  isTable,
  label,
  pathText,
  removeAt,
  setAt,
  type Column,
  type Group,
  type Json,
  type Path,
} from "../structured";
import s from "./StructuredDataView.module.css";

/** main `StructuredDataView.vue` (FR-SYS-105, 114): header fields as label/value rows and
 * line tables, in the template's order, or the generic result's saved order. Marks:
 * required and empty, type or precision warnings (FR-OCR-016), amounts that do not add up
 * (FR-OCR-013, ours). In a generic result, fields can be added (name required, not
 * duplicated) and removed; rows can be added and removed everywhere. */

interface Row {
  key: string;
  name: string;
  path: Path;
  type?: string;
  required?: boolean;
  owned: boolean;
}
interface FieldSection {
  kind: "fields";
  path: Path;
  title: string | null;
  rows: Row[];
  owned: boolean;
}
interface TableSection {
  kind: "table";
  path: Path;
  title: string;
  columns: Column[];
}
type Section = FieldSection | TableSection;
interface GroupView {
  key: string;
  name: string | null;
  sections: Section[];
}

function columnsOf(rows: Json[]): Column[] {
  const keys: string[] = [];
  for (const row of rows) if (isObj(row)) for (const k of Object.keys(row)) if (!keys.includes(k)) keys.push(k);
  return keys.map((key) => ({ key, name: key }));
}

function templateView(groups: Group[], lang: ReturnType<typeof useLanguage.getState>["lang"]): GroupView[] {
  return groups.map((group) => {
    const rows: Row[] = group.items
      .filter((i) => i.kind === "field")
      .map((i) => ({ key: i.key, name: label(i, lang), path: [group.key, i.key], type: i.type, required: i.required, owned: true }));
    const tables: TableSection[] = group.items
      .filter((i) => i.kind === "table")
      .map((i) => ({ kind: "table", path: [group.key, i.key], title: label(i, lang), columns: i.columns ?? [] }));
    const fields: FieldSection[] = rows.length ? [{ kind: "fields", path: [group.key], title: null, rows, owned: true }] : [];
    return { key: group.key, name: label(group, lang), sections: [...fields, ...tables] };
  });
}

function genericView(value: Json, docInfo: string): GroupView[] {
  const root = isObj(value) ? value : {};
  const loose: Row[] = [];
  const views: GroupView[] = [];
  const rootTables: TableSection[] = [];
  for (const [key, v] of Object.entries(root)) {
    if (isObj(v)) {
      const rows: Row[] = [];
      const tables: TableSection[] = [];
      for (const [k, inner] of Object.entries(v)) {
        if (isTable(inner) && inner.length) tables.push({ kind: "table", path: [key, k], title: k, columns: columnsOf(inner) });
        else rows.push({ key: k, name: k, path: [key, k], owned: false });
      }
      views.push({ key, name: null, sections: [{ kind: "fields", path: [key], title: key, rows, owned: false }, ...tables] });
    } else if (isTable(v) && v.length) {
      rootTables.push({ kind: "table", path: [key], title: key, columns: columnsOf(v) });
    } else {
      loose.push({ key, name: key, path: [key], owned: false });
    }
  }
  const head: GroupView[] = loose.length || (!views.length && !rootTables.length)
    ? [{ key: "", name: null, sections: [{ kind: "fields", path: [], title: docInfo, rows: loose, owned: false }] }]
    : [];
  const tail: GroupView[] = rootTables.length ? [{ key: "#tables", name: null, sections: rootTables }] : [];
  return [...head, ...views, ...tail];
}

const NUMERIC = new Set(["decimal", "amount"]);

/** Read-only text: decimals and amounts with thousands separators, never through a float. */
export function formatCell(value: Json, type?: string): string {
  const text = asText(value);
  if (!type || !NUMERIC.has(type) || !/^-?\d+(\.\d+)?$/.test(text)) return text;
  const [whole = "", frac] = text.split(".");
  const sign = whole.startsWith("-") ? "-" : "";
  const digits = sign ? whole.slice(1) : whole;
  return `${sign}${digits.replace(/\B(?=(\d{3})+(?!\d))/g, ",")}${frac !== undefined ? `.${frac}` : ""}`;
}

export function StructuredDataView({ value, groups, schemaName, missing, warnings, amountIssues, editable, onChange }: {
  value: Json;
  groups: Group[] | null;
  schemaName?: string | null;
  missing: Set<string>;
  warnings: Set<string>;
  amountIssues: Map<string, string>;
  editable: boolean;
  onChange(next: Json): void;
}) {
  const t = useT();
  const lang = useLanguage((st) => st.lang);
  const [adding, setAdding] = useState<Record<string, { name: string; value: string; tried: boolean }>>({});
  const views = groups ? templateView(groups, lang) : genericView(value, t("result.documentInfo"));
  const cls = (...n: (string | false | undefined)[]) => n.filter(Boolean).map((k) => s[k as string] ?? k).join(" ");

  const marks = (path: Path) => {
    const key = pathText(path);
    return {
      key,
      missing: missing.has(key),
      warning: warnings.has(key),
      computed: amountIssues.get(key),
    };
  };

  function input(path: Path, name: string, type?: string, required?: boolean) {
    const m = marks(path);
    return editable ? (
      <>
        <input
          className={s["cell-input"]}
          aria-label={name}
          aria-required={required || undefined}
          aria-invalid={m.missing || undefined}
          inputMode={type && (NUMERIC.has(type) || type === "integer") ? "decimal" : undefined}
          value={asText(getAt(value, path))}
          onChange={(e) => onChange(setAt(value, path, e.target.value))}
          onBlur={() => {
            const text = asText(getAt(value, path));
            const clean = cleanValue(text, type);
            if (clean !== text) onChange(setAt(value, path, clean));
          }}
        />
        {m.computed && <span className={s["amount-hint"]}>{t("result.computed", { value: m.computed })}</span>}
      </>
    ) : (
      <span className={s["cell-text"]} aria-label={name}>
        {formatCell(getAt(value, path), type) || "—"}
        {m.computed && <span className={s["amount-hint"]}>{t("result.computed", { value: m.computed })}</span>}
      </span>
    );
  }

  function fieldError(sec: FieldSection): string | null {
    const draft = adding[pathText(sec.path)];
    if (!draft) return null;
    const name = draft.name.trim();
    if (!name) return t("result.fieldNameRequired");
    const node = sec.path.length ? getAt(value, sec.path) : value;
    if (isObj(node) && name in node) return t("result.fieldNameDuplicate");
    return null;
  }

  function submitField(sec: FieldSection) {
    const key = pathText(sec.path);
    const draft = adding[key];
    if (!draft) return;
    if (fieldError(sec)) {
      setAdding({ ...adding, [key]: { ...draft, tried: true } });
      return;
    }
    onChange(setAt(value, [...sec.path, draft.name.trim()], draft.value));
    const next = { ...adding };
    delete next[key];
    setAdding(next);
  }

  const empty = views.every((g) => g.sections.every((sec) => (sec.kind === "fields" ? !sec.rows.length && !editable : false)));
  return (
    <div className={cls("structured", Boolean(groups) && "template-view")}>
      {groups && schemaName && <div className={s["schema-name"]}>{schemaName}</div>}
      {empty && <div className={s["table-empty"]}>{t("result.noTables")}</div>}
      {views.map((group) => (
        <div key={group.key} className={s["structured-group"]}>
          {groups && group.name && <div className={s["group-name"]}>{group.name}</div>}
          {group.sections.map((sec) =>
            sec.kind === "fields" ? (
              (sec.rows.length > 0 || editable || !sec.owned) && (
                <section key={`f-${pathText(sec.path)}`} className={s["table-card"]}>
                  {sec.title && <div className={s["table-title"]}>{sec.title}</div>}
                  <dl className={s["detail-list"]}>
                    {sec.rows.map((row) => {
                      const m = marks(row.path);
                      return (
                        <div
                          key={m.key}
                          data-path={m.key}
                          className={cls(
                            "detail-row",
                            editable && !row.owned && "with-actions",
                            m.missing && "required-missing",
                            m.warning && "type-warning",
                            m.computed && "amount-issue",
                          )}
                          tabIndex={-1}
                        >
                          <dt>
                            {row.name}
                            {row.required && <span className={s["required-star"]}> *</span>}
                          </dt>
                          <dd>{input(row.path, row.name, row.type, row.required)}</dd>
                          {editable && !row.owned && (
                            <button
                              type="button"
                              className={s["row-delete"]}
                              aria-label={`${t("result.deleteField")}: ${row.name}`}
                              onClick={() => onChange(removeAt(value, row.path))}
                            >
                              <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                                <path d="M4 7h16M9 7V5h6v2M7 7l1 12h8l1-12M10 11v5M14 11v5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                              </svg>
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </dl>
                  {editable && !sec.owned && (
                    <div className={s["card-footer"]}>
                      {adding[pathText(sec.path)] ? (
                        <form
                          className={s["add-field-form"]}
                          onSubmit={(e) => {
                            e.preventDefault();
                            submitField(sec);
                          }}
                        >
                          <input
                            className={s["add-name"]}
                            placeholder={t("result.fieldName")}
                            aria-label={t("result.fieldName")}
                            aria-invalid={(adding[pathText(sec.path)]!.tried && !!fieldError(sec)) || undefined}
                            value={adding[pathText(sec.path)]!.name}
                            onChange={(e) => setAdding({ ...adding, [pathText(sec.path)]: { ...adding[pathText(sec.path)]!, name: e.target.value } })}
                          />
                          <input
                            className={s["add-value"]}
                            placeholder={t("result.fieldValue")}
                            aria-label={t("result.fieldValue")}
                            value={adding[pathText(sec.path)]!.value}
                            onChange={(e) => setAdding({ ...adding, [pathText(sec.path)]: { ...adding[pathText(sec.path)]!, value: e.target.value } })}
                          />
                          <button type="submit" className={cls("form-btn", "confirm")} aria-label={t("result.addField")}>
                            +
                          </button>
                          <button
                            type="button"
                            className={cls("form-btn", "cancel")}
                            aria-label={t("common.cancel")}
                            onClick={() => {
                              const next = { ...adding };
                              delete next[pathText(sec.path)];
                              setAdding(next);
                            }}
                          >
                            ×
                          </button>
                          {adding[pathText(sec.path)]!.tried && fieldError(sec) && (
                            <p className={s["field-error"]} role="alert">
                              {fieldError(sec)}
                            </p>
                          )}
                        </form>
                      ) : (
                        <button
                          type="button"
                          className={s["add-btn"]}
                          onClick={() => setAdding({ ...adding, [pathText(sec.path)]: { name: "", value: "", tried: false } })}
                        >
                          + {t("result.addField")}
                        </button>
                      )}
                    </div>
                  )}
                </section>
              )
            ) : (
              <section key={`t-${pathText(sec.path)}`} className={s["table-card"]} data-table={pathText(sec.path)}>
                <div className={s["table-title"]}>{sec.title}</div>
                <div className={s["table-scroll"]}>
                  <table>
                    <thead>
                      <tr>
                        {sec.columns.map((c) => (
                          <th key={c.key}>
                            {label(c, lang)}
                            {c.required && <span className={s["required-star"]}> *</span>}
                          </th>
                        ))}
                        {editable && <th className={s["row-actions"]} />}
                      </tr>
                    </thead>
                    <tbody>
                      {(() => {
                        const rows = getAt(value, sec.path);
                        const list = Array.isArray(rows) ? rows : [];
                        if (!list.length)
                          return (
                            <tr>
                              <td colSpan={sec.columns.length + 1} className={s["empty-rows"]}>
                                {t("result.emptyTable")}
                              </td>
                            </tr>
                          );
                        return list.map((_, idx) => (
                          <tr key={idx} data-row={idx}>
                            {sec.columns.map((c) => {
                              const path = [...sec.path, idx, c.key];
                              const m = marks(path);
                              return (
                                <td
                                  key={c.key}
                                  data-path={m.key}
                                  className={cls(m.missing && "required-missing", m.warning && "type-warning", m.computed && "amount-issue")}
                                  tabIndex={-1}
                                >
                                  {input(path, label(c, lang), c.type, c.required)}
                                </td>
                              );
                            })}
                            {editable && (
                              <td className={s["row-actions"]}>
                                <button
                                  type="button"
                                  className={s["row-delete"]}
                                  aria-label={`${t("result.deleteRow")} ${idx + 1}`}
                                  onClick={() => onChange(removeAt(value, [...sec.path, idx]))}
                                >
                                  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true">
                                    <path d="M4 7h16M9 7V5h6v2M7 7l1 12h8l1-12M10 11v5M14 11v5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
                                  </svg>
                                </button>
                              </td>
                            )}
                          </tr>
                        ));
                      })()}
                    </tbody>
                  </table>
                </div>
                {editable && (
                  <div className={s["card-footer"]}>
                    <button
                      type="button"
                      className={s["add-btn"]}
                      onClick={() => {
                        const rows = getAt(value, sec.path);
                        const list = Array.isArray(rows) ? rows : [];
                        onChange(setAt(value, [...sec.path, list.length], Object.fromEntries(sec.columns.map((c) => [c.key, ""]))));
                      }}
                    >
                      + {t("result.addRow")}
                    </button>
                  </div>
                )}
              </section>
            ),
          )}
        </div>
      ))}
    </div>
  );
}
