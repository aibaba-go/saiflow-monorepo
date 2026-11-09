import { Descriptions, Space, Table, Typography } from "antd";

import type { T } from "../i18n";
import type { Lang } from "../stores/language";

/** Template structure, as in apps/line-mini structured.ts (copied, not shared). */
export interface Column {
  key: string;
  name?: string;
  names?: Partial<Record<Lang, string>>;
}
export interface Item extends Column {
  kind: "field" | "table";
  columns?: Column[];
}
export interface Group extends Column {
  items: Item[];
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isRows = (v: unknown): v is Obj[] => Array.isArray(v) && v.every(isObj);

export function label(item: Column, lang: Lang): string {
  return item.names?.[lang] || item.name || item.key;
}

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(text).join(", ");
  return typeof value === "object" ? JSON.stringify(value) : String(value);
}

function RowsTable({ title, columns, rows }: { title: string; columns: { key: string; title: string }[]; rows: Obj[] }) {
  return (
    <Table<Obj & { _i: number }>
      size="small"
      bordered
      pagination={false}
      title={() => <Typography.Text strong>{title}</Typography.Text>}
      rowKey="_i"
      dataSource={rows.map((r, i) => ({ ...r, _i: i }))}
      columns={columns.map((c) => ({ key: c.key, title: c.title, render: (_: unknown, r: Obj) => text(r[c.key]) }))}
      scroll={{ x: true }}
    />
  );
}

/** A confirmed result read-only (FR-SYS-124): a template result by its groups and field
 * order, field names in the UI language; a generic result by its saved groups and tables. */
export function ReadonlyResult({ value, groups, lang, t }: { value: unknown; groups: Group[] | null; lang: Lang; t: T }) {
  const data = isObj(value) ? value : {};
  if (groups) {
    return (
      <Space direction="vertical" style={{ width: "100%" }} size="middle">
        {groups.map((g) => {
          const gv = isObj(data[g.key]) ? (data[g.key] as Obj) : {};
          const fields = g.items.filter((i) => i.kind === "field");
          const tables = g.items.filter((i) => i.kind === "table");
          return (
            <Space key={g.key} direction="vertical" style={{ width: "100%" }}>
              {fields.length > 0 && (
                <section className="pc-readonly" aria-label={label(g, lang)}>
                  <h3 className="pc-readonly__title">{label(g, lang)}</h3>
                  <dl className="pc-readonly__grid">
                    {fields.map((f) => (
                      <div key={f.key} className="pc-readonly__field">
                        <dt>{label(f, lang)}</dt>
                        <dd>{text(gv[f.key]) || "\u00a0"}</dd>
                      </div>
                    ))}
                  </dl>
                </section>
              )}
              {tables.map((tb) => (
                <RowsTable
                  key={tb.key}
                  title={label(tb, lang)}
                  columns={(tb.columns ?? []).map((c) => ({ key: c.key, title: label(c, lang) }))}
                  rows={isRows(gv[tb.key]) ? (gv[tb.key] as Obj[]) : []}
                />
              ))}
            </Space>
          );
        })}
      </Space>
    );
  }
  const entries = Object.entries(data);
  if (!entries.length) return <Typography.Text type="secondary">{t("review.noData")}</Typography.Text>;
  return (
    <Space direction="vertical" style={{ width: "100%" }} size="middle">
      {entries.map(([gk, gv]) => {
        if (!isObj(gv)) {
          return (
            <Descriptions key={gk} size="small" bordered column={1}>
              <Descriptions.Item label={gk}>{text(gv)}</Descriptions.Item>
            </Descriptions>
          );
        }
        const scalars = Object.entries(gv).filter(([, v]) => !isRows(v) || (v as Obj[]).length === 0);
        const tables = Object.entries(gv).filter(([, v]) => isRows(v) && (v as Obj[]).length > 0);
        return (
          <Space key={gk} direction="vertical" style={{ width: "100%" }}>
            {scalars.length > 0 && (
              <Descriptions size="small" bordered column={1} title={gk}>
                {scalars.map(([k, v]) => (
                  <Descriptions.Item key={k} label={k}>
                    {text(v)}
                  </Descriptions.Item>
                ))}
              </Descriptions>
            )}
            {tables.map(([k, v]) => {
              const rows = v as Obj[];
              const keys = [...new Set(rows.flatMap((r) => Object.keys(r)))];
              return <RowsTable key={k} title={k} columns={keys.map((c) => ({ key: c, title: c }))} rows={rows} />;
            })}
          </Space>
        );
      })}
    </Space>
  );
}
