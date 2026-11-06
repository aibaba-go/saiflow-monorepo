import { Button, Card, Input } from "antd-mobile";
import { useState } from "react";

import { useT } from "../../i18n";
import { useLanguage } from "../../stores/language";
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
} from "./structured";

interface Props {
  value: Json;
  groups: Group[] | null;
  missing: Set<string>;
  onChange(next: Json): void;
}

function FieldInput({ name, path, type, required, props }: {
  name: string;
  path: Path;
  type?: string;
  required?: boolean;
  props: Props;
}) {
  const t = useT();
  const key = pathText(path);
  const bad = props.missing.has(key);
  return (
    <div className={bad ? "result__field result__field--missing" : "result__field"} data-path={key}>
      <span className="field__label">
        {name}
        {required && <span className="result__required"> *</span>}
      </span>
      <Input
        aria-label={name}
        aria-invalid={bad || undefined}
        value={asText(getAt(props.value, path))}
        onChange={(text) => props.onChange(setAt(props.value, path, text))}
        onBlur={() => {
          const text = asText(getAt(props.value, path));
          const clean = cleanValue(text, type);
          if (clean !== text) props.onChange(setAt(props.value, path, clean));
        }}
      />
      {bad && <span className="field-error">{t("scan.required")}</span>}
    </div>
  );
}

function TableEditor({ title, path, columns, props }: {
  title: string;
  path: Path;
  columns: Column[];
  props: Props;
}) {
  const t = useT();
  const lang = useLanguage((s) => s.lang);
  const rows = getAt(props.value, path);
  const list = Array.isArray(rows) ? rows : [];
  const empty = Object.fromEntries(columns.map((c) => [c.key, ""]));
  return (
    <div className="result__table" data-table={pathText(path)}>
      <div className="section__label">{title}</div>
      {list.map((_, index) => (
        <div key={index} className="result__row" data-row={index}>
          {columns.map((col) => (
            <FieldInput
              key={col.key}
              name={label(col, lang)}
              path={[...path, index, col.key]}
              type={col.type}
              required={col.required}
              props={props}
            />
          ))}
          <Button
            size="mini"
            fill="none"
            aria-label={t("scan.removeRow", { n: index + 1 })}
            onClick={() => props.onChange(removeAt(props.value, [...path, index]))}
          >
            {t("scan.removeRow", { n: index + 1 })}
          </Button>
        </div>
      ))}
      <Button size="small" onClick={() => props.onChange(setAt(props.value, [...path, list.length], empty))}>
        {t("scan.addRow")}
      </Button>
    </div>
  );
}

function TemplateView({ groups, props }: { groups: Group[]; props: Props }) {
  const lang = useLanguage((s) => s.lang);
  return (
    <>
      {groups.map((group) => (
        <Card key={group.key} title={label(group, lang)}>
          {group.items.map((item) =>
            item.kind === "field" ? (
              <FieldInput
                key={item.key}
                name={label(item, lang)}
                path={[group.key, item.key]}
                type={item.type}
                required={item.required}
                props={props}
              />
            ) : (
              <TableEditor
                key={item.key}
                title={label(item, lang)}
                path={[group.key, item.key]}
                columns={item.columns ?? []}
                props={props}
              />
            ),
          )}
        </Card>
      ))}
    </>
  );
}

function AddField({ path, props }: { path: Path; props: Props }) {
  const t = useT();
  const [name, setName] = useState("");
  const add = () => {
    const key = name.trim();
    if (!key || getAt(props.value, [...path, key]) !== null) return;
    props.onChange(setAt(props.value, [...path, key], ""));
    setName("");
  };
  return (
    <div className="field__row">
      <Input aria-label={t("scan.fieldName")} placeholder={t("scan.fieldName")} value={name} onChange={setName} />
      <Button size="small" onClick={add}>
        {t("scan.addField")}
      </Button>
    </div>
  );
}

function columnsOf(rows: Json[]): Column[] {
  const keys: string[] = [];
  for (const row of rows) if (isObj(row)) for (const k of Object.keys(row)) if (!keys.includes(k)) keys.push(k);
  return keys.map((key) => ({ key, name: key }));
}

/** A generic result in its saved order: sections of fields and tables (FR-OCR-023); fields
 * can be added and removed, rows too (FR-SYS-105). */
function GenericSection({ title, path, props }: { title: string | null; path: Path; props: Props }) {
  const t = useT();
  const node = getAt(props.value, path);
  const entries = isObj(node) ? Object.entries(node) : [];
  return (
    <Card title={title ?? undefined}>
      {entries.map(([key, value]) => {
        if (isObj(value) && path.length === 0) return null; // own section below
        if (isTable(value) && value.length)
          return <TableEditor key={key} title={key} path={[...path, key]} columns={columnsOf(value)} props={props} />;
        return (
          <div key={key} className="result__generic">
            <FieldInput name={key} path={[...path, key]} props={props} />
            <Button
              size="mini"
              fill="none"
              aria-label={t("scan.removeField", { name: key })}
              onClick={() => props.onChange(removeAt(props.value, [...path, key]))}
            >
              {t("common.delete")}
            </Button>
          </div>
        );
      })}
      <AddField path={path} props={props} />
    </Card>
  );
}

export function StructuredEditor(props: Props) {
  const t = useT();
  if (props.groups) return <TemplateView groups={props.groups} props={props} />;
  const root = isObj(props.value) ? props.value : {};
  const sections = Object.entries(root).filter(([, v]) => isObj(v));
  const loose = Object.values(root).some((v) => !isObj(v));
  if (!sections.length && !loose && !Object.keys(root).length)
    return (
      <>
        <div className="usage__hint">{t("scan.empty")}</div>
        <GenericSection title={null} path={[]} props={props} />
      </>
    );
  return (
    <>
      {(loose || !sections.length) && <GenericSection title={null} path={[]} props={props} />}
      {sections.map(([key]) => (
        <GenericSection key={key} title={key} path={[key]} props={props} />
      ))}
    </>
  );
}
