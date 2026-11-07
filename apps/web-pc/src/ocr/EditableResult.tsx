import { Button, Card, Input, Modal, Space, Table, Typography } from "antd";
import { useState } from "react";

import { useT } from "../i18n";
import { useLanguage } from "../stores/language";
import {
  asText,
  cleanValue,
  type Column,
  getAt,
  type Group,
  isObj,
  isNumeric,
  isTable,
  type Json,
  label,
  type Obj,
  type Path,
  pathText,
  removeAt,
  setAt,
} from "./structured";

type Marks = {
  missing: Set<string>;
  warnings: Set<string>;
  amountIssues: Map<string, string>;
};

function markClass(path: string, m: Marks): string {
  return [
    m.missing.has(path) && "required-missing",
    m.warnings.has(path) && "type-warning",
    m.amountIssues.has(path) && "amount-issue",
  ]
    .filter(Boolean)
    .join(" ");
}

function FieldInput({
  path,
  name,
  type,
  value,
  marks,
  editable,
  onSet,
}: {
  path: Path;
  name: string;
  type?: string;
  value: Json;
  marks: Marks;
  editable: boolean;
  onSet: (path: Path, value: Json) => void;
}) {
  const t = useT();
  const key = pathText(path);
  const cls = markClass(key, marks);
  const computed = marks.amountIssues.get(key);
  return (
    <div data-path={key} className={cls} style={{ marginBottom: 8 }}>
      <Typography.Text type={cls ? "danger" : undefined} style={{ display: "block", fontSize: 12 }}>
        {name}
        {marks.missing.has(key) && ` · ${t("ocr.requiredMissing")}`}
        {marks.warnings.has(key) && ` · ${t("ocr.typeWarning")}`}
        {computed !== undefined && ` · ${t("ocr.amountIssue", { value: computed })}`}
      </Typography.Text>
      <Input
        aria-label={name}
        status={cls ? "error" : undefined}
        disabled={!editable}
        value={asText(value)}
        onChange={(e) => onSet(path, cleanValue(e.target.value, type))}
      />
    </div>
  );
}

function RowsEditor({
  path,
  title,
  columns,
  rows,
  marks,
  editable,
  onSet,
  onChangeRows,
}: {
  path: Path;
  title: string;
  columns: Column[];
  rows: Obj[];
  marks: Marks;
  editable: boolean;
  onSet: (path: Path, value: Json) => void;
  onChangeRows: (rows: Obj[]) => void;
}) {
  const t = useT();
  const lang = useLanguage((s) => s.lang);
  return (
    <div style={{ marginBottom: 12 }}>
      <Table<Obj & { _i: number }>
        size="small"
        bordered
        pagination={false}
        scroll={{ x: true }}
        title={() => <Typography.Text strong>{title}</Typography.Text>}
        rowKey="_i"
        dataSource={rows.map((r, i) => ({ ...r, _i: i }))}
        columns={[
          ...columns.map((c) => ({
            key: c.key,
            title: label(c, lang),
            align: isNumeric(c.type) ? ("right" as const) : undefined,
            className: isNumeric(c.type) ? "num" : undefined,
            render: (_: unknown, r: Obj & { _i: number }) => {
              const p = [...path, r._i, c.key];
              const key = pathText(p);
              const cls = markClass(key, marks);
              return (
                <div data-path={key} className={cls}>
                  <Input
                    size="small"
                    className={isNumeric(c.type) ? "num num--right" : undefined}
                    aria-label={`${label(c, lang)} ${r._i + 1}`}
                    status={cls ? "error" : undefined}
                    disabled={!editable}
                    value={asText(r[c.key] ?? null)}
                    onChange={(e) => onSet(p, cleanValue(e.target.value, c.type))}
                  />
                </div>
              );
            },
          })),
          ...(editable
            ? [
                {
                  key: "_del",
                  title: "",
                  width: 60,
                  render: (_: unknown, r: Obj & { _i: number }) => (
                    <Button
                      size="small"
                      danger
                      aria-label={t("ocr.deleteRow")}
                      onClick={() => onChangeRows(rows.filter((_, i) => i !== r._i))}
                    >
                      ×
                    </Button>
                  ),
                },
              ]
            : []),
        ]}
      />
      {editable && (
        <Button
          size="small"
          style={{ marginTop: 6 }}
          onClick={() => onChangeRows([...rows, Object.fromEntries(columns.map((c) => [c.key, ""])) as Obj])}
        >
          {t("ocr.addRow")}
        </Button>
      )}
    </div>
  );
}

function AddField({ existing, onAdd }: { existing: string[]; onAdd: (name: string) => void }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const submit = () => {
    const n = name.trim();
    if (!n) return setError(t("ocr.fieldNameRequired"));
    if (existing.includes(n)) return setError(t("ocr.fieldNameTaken"));
    onAdd(n);
    setOpen(false);
  };
  return (
    <>
      <Button
        size="small"
        onClick={() => {
          setName("");
          setError(null);
          setOpen(true);
        }}
      >
        {t("ocr.addField")}
      </Button>
      <Modal
        open={open}
        title={t("ocr.addField")}
        okText={t("ocr.add")}
        cancelText={t("common.cancel")}
        onOk={submit}
        onCancel={() => setOpen(false)}
      >
        <Input aria-label={t("ocr.fieldName")} value={name} onChange={(e) => setName(e.target.value)} />
        {error && <Typography.Text type="danger">{error}</Typography.Text>}
      </Modal>
    </>
  );
}

/** The editable result (FR-SYS-129): a template result by its groups and field order with
 * line-item tables (add and delete rows); a generic result by its saved groups, where
 * header fields can be added (name required, unique in the group) and deleted. Missing
 * required fields, values that do not fit the type and amounts that do not add up are
 * marked. Numbers stay decimal text (ported rules from apps/line-mini). */
export function EditableResult({
  value,
  groups,
  missing,
  warnings,
  amountIssues,
  editable,
  onChange,
}: {
  value: Json;
  groups: Group[] | null;
  missing: Set<string>;
  warnings: Set<string>;
  amountIssues: Map<string, string>;
  editable: boolean;
  onChange: (next: Json) => void;
}) {
  const t = useT();
  const lang = useLanguage((s) => s.lang);
  const marks = { missing, warnings, amountIssues };
  const root: Json = isObj(value) ? value : {};
  const set = (path: Path, v: Json) => onChange(setAt(root, path, v));

  if (groups) {
    return (
      <Space direction="vertical" style={{ width: "100%" }}>
        {groups.map((g) => {
          const gv = isObj(root[g.key as never]) ? (root as Obj)[g.key] : {};
          return (
            <Card key={g.key} size="small" title={label(g, lang)}>
              {g.items.map((item) =>
                item.kind === "field" ? (
                  <FieldInput
                    key={item.key}
                    path={[g.key, item.key]}
                    name={label(item, lang)}
                    type={item.type}
                    value={getAt(root, [g.key, item.key])}
                    marks={marks}
                    editable={editable}
                    onSet={set}
                  />
                ) : (
                  <RowsEditor
                    key={item.key}
                    path={[g.key, item.key]}
                    title={label(item, lang)}
                    columns={item.columns ?? []}
                    rows={isTable((gv as Obj)[item.key]) ? ((gv as Obj)[item.key] as Obj[]) : []}
                    marks={marks}
                    editable={editable}
                    onSet={set}
                    onChangeRows={(rows) => set([g.key, item.key], rows)}
                  />
                ),
              )}
            </Card>
          );
        })}
      </Space>
    );
  }

  const entries = Object.entries(root as Obj);
  if (!entries.length) return <Typography.Text type="secondary">{t("review.noData")}</Typography.Text>;
  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      {entries.map(([gk, gv]) => {
        if (!isObj(gv)) {
          return (
            <Card key={gk} size="small">
              <FieldInput path={[gk]} name={gk} value={gv} marks={marks} editable={editable} onSet={set} />
            </Card>
          );
        }
        const fieldKeys = Object.keys(gv).filter((k) => !isTable(gv[k]) || (gv[k] as Obj[]).length === 0);
        const tableKeys = Object.keys(gv).filter((k) => isTable(gv[k]) && (gv[k] as Obj[]).length > 0);
        return (
          <Card
            key={gk}
            size="small"
            title={gk}
            extra={editable ? <AddField existing={Object.keys(gv)} onAdd={(n) => set([gk, n], "")} /> : null}
          >
            {fieldKeys.map((k) => (
              <Space key={k} align="end" style={{ width: "100%" }}>
                <div style={{ flex: 1 }}>
                  <FieldInput path={[gk, k]} name={k} value={gv[k] ?? null} marks={marks} editable={editable} onSet={set} />
                </div>
                {editable && (
                  <Button
                    size="small"
                    danger
                    aria-label={t("ocr.deleteField")}
                    style={{ marginBottom: 8 }}
                    onClick={() => onChange(removeAt(root, [gk, k]))}
                  >
                    ×
                  </Button>
                )}
              </Space>
            ))}
            {tableKeys.map((k) => {
              const rows = gv[k] as Obj[];
              const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))].map((c) => ({ key: c, name: c }));
              return (
                <RowsEditor
                  key={k}
                  path={[gk, k]}
                  title={k}
                  columns={columns}
                  rows={rows}
                  marks={marks}
                  editable={editable}
                  onSet={set}
                  onChangeRows={(next) => set([gk, k], next)}
                />
              );
            })}
          </Card>
        );
      })}
    </Space>
  );
}
