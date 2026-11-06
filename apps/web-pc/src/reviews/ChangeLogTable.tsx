import { Table } from "antd";

import { formatBangkokDateTime } from "../format";
import type { T } from "../i18n";
import type { Lang } from "../stores/language";
import type { ChangeEntry } from "./api";
import { type Group, label } from "./ReadonlyResult";

const ROW = /^([^.[\]]+)\.([^.[\]]+)\[(\d+)\]\.(.+)$/;
const FIELD = /^([^.[\]]+)\.([^.[\]]+)$/;

/** A change log path in words (ported from apps/line-mini changeLabel.ts). */
export function changeLabel(path: string, groups: Group[] | null, t: T, lang: Lang = "en"): string {
  if (!groups) return path;
  const row = ROW.exec(path);
  if (row) {
    const [, g, table, idx, col] = row;
    const item = groups.find((x) => x.key === g)?.items.find((i) => i.key === table && i.kind === "table");
    const column = item?.columns?.find((c) => c.key === col);
    return item && column
      ? t("review.changes.row", { table: label(item, lang), n: Number(idx) + 1, col: label(column, lang) })
      : path;
  }
  const field = FIELD.exec(path);
  if (field) {
    const [, g, key] = field;
    const item = groups.find((x) => x.key === g)?.items.find((i) => i.key === key && i.kind === "field");
    if (item) return label(item, lang);
  }
  return path;
}

function show(value: unknown, empty: string): string {
  if (value === null || value === undefined || value === "") return empty;
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** The change log of a job (FR-VERIFY-007): field, before, after, who, when. */
export function ChangeLogTable({ entries, groups, t, lang }: { entries: ChangeEntry[]; groups: Group[] | null; t: T; lang: Lang }) {
  const empty = t("review.changes.empty_value");
  const generic = t("review.changes.generic");
  return (
    <Table<ChangeEntry & { _i: number }>
      size="small"
      bordered
      pagination={false}
      rowKey="_i"
      locale={{ emptyText: t("review.changes.empty") }}
      dataSource={entries.map((e, i) => ({ ...e, _i: i }))}
      columns={[
        {
          key: "field",
          title: t("review.changes.field"),
          render: (_, c) =>
            c.kind === "TEMPLATE"
              ? t("review.changes.template", { from: c.from_template ?? generic, to: c.to_template ?? generic })
              : changeLabel(c.path ?? "", groups, t, lang),
        },
        { key: "before", title: t("review.changes.before"), render: (_, c) => (c.kind === "TEMPLATE" ? "" : show(c.before, empty)) },
        { key: "after", title: t("review.changes.after"), render: (_, c) => (c.kind === "TEMPLATE" ? "" : show(c.after, empty)) },
        { key: "user", title: t("review.changes.user"), render: (_, c) => c.user_name ?? "-" },
        { key: "time", title: t("review.changes.time"), render: (_, c) => formatBangkokDateTime(c.created_at) },
      ]}
    />
  );
}
