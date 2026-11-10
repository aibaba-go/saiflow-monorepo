import { Button, Card, Input, Modal, Space, Table, Typography } from "antd";
import { Fragment, type PointerEvent, useRef, useState } from "react";

import { Icon } from "../layout/icons";

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

type RowsProps = {
  path: Path;
  title: string;
  columns: Column[];
  rows: Obj[];
  marks: Marks;
  editable: boolean;
  onSet: (path: Path, value: Json) => void;
  onChangeRows: (rows: Obj[]) => void;
};

/** The line-item grid. `wide` is the dialog's roomy version: a row-number column, wider
 * cells and a header that stays put while the rows scroll. */
function RowsTable({ path, columns, rows, marks, editable, onSet, onChangeRows, wide }: RowsProps & { wide: boolean }) {
  const t = useT();
  const lang = useLanguage((s) => s.lang);
  const cellWidth = wide ? 168 : 120;
  return (
    <Table<Obj & { _i: number }>
      className={wide ? "pc-rows pc-rows--wide" : "pc-rows"}
      size={wide ? "middle" : "small"}
      bordered
      pagination={false}
      scroll={wide ? { x: "max-content", y: "calc(min(72vh, 760px) - 150px)" } : { x: "max-content" }}
      rowKey="_i"
      dataSource={rows.map((r, i) => ({ ...r, _i: i }))}
      columns={[
        ...(wide
          ? [
              {
                key: "_no",
                title: "#",
                width: 52,
                fixed: "left" as const,
                align: "center" as const,
                render: (_: unknown, r: Obj & { _i: number }) => <span className="pc-rows__no">{r._i + 1}</span>,
              },
            ]
          : []),
        ...columns.map((c) => ({
          key: c.key,
          title: label(c, lang),
          width: cellWidth,
          align: isNumeric(c.type) ? ("right" as const) : undefined,
          className: isNumeric(c.type) ? "num" : undefined,
          render: (_: unknown, r: Obj & { _i: number }) => {
            const p = [...path, r._i, c.key];
            const key = pathText(p);
            const cls = markClass(key, marks);
            const text = asText(r[c.key] ?? null);
            return (
              <div data-path={key} className={cls}>
                <Input
                  size={wide ? "middle" : "small"}
                  className={isNumeric(c.type) ? "num num--right" : undefined}
                  style={{ minWidth: cellWidth - 16 }}
                  aria-label={`${label(c, lang)} ${r._i + 1}`}
                  title={text || undefined}
                  status={cls ? "error" : undefined}
                  disabled={!editable}
                  value={text}
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
                width: 56,
                fixed: wide ? ("right" as const) : undefined,
                align: "center" as const,
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
  );
}

const blankRow = (columns: Column[]) => Object.fromEntries(columns.map((c) => [c.key, ""])) as Obj;

/** A dialog the user can move by its title bar, so the original or the fields beside it stay
 * readable while the table is open. The offset resets each time it opens. */
function useDrag() {
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const start = useRef<{ x: number; y: number; ox: number; oy: number } | null>(null);
  const handle = {
    onPointerDown(e: PointerEvent<HTMLElement>) {
      if (e.button !== 0 || (e.target as HTMLElement).closest("button")) return;
      start.current = { x: e.clientX, y: e.clientY, ox: offset.x, oy: offset.y };
      e.currentTarget.setPointerCapture?.(e.pointerId);
    },
    onPointerMove(e: PointerEvent<HTMLElement>) {
      const from = start.current;
      if (!from) return;
      // keep the title bar reachable on screen
      const maxX = window.innerWidth / 2;
      const maxY = window.innerHeight - 120;
      setOffset({
        x: Math.max(-maxX, Math.min(maxX, from.ox + e.clientX - from.x)),
        y: Math.max(-80, Math.min(maxY, from.oy + e.clientY - from.y)),
      });
    },
    onPointerUp() {
      start.current = null;
    },
  };
  return { offset, reset: () => setOffset({ x: 0, y: 0 }), handle };
}

/** A line-item table (FR-SYS-129): compact in the result; "Expand" opens the same rows in a
 * large movable dialog where every cell has room. Both edit the same draft. */
function RowsEditor(props: RowsProps) {
  const { title, columns, rows, editable, onChangeRows } = props;
  const t = useT();
  const [open, setOpen] = useState(false);
  const drag = useDrag();
  const addRow = () => onChangeRows([...rows, blankRow(columns)]);
  return (
    <div className="pc-rows-block" style={{ marginBottom: 12 }}>
      <div className="pc-rows-block__head">
        <Typography.Text strong>{title}</Typography.Text>
        <span className="pc-rows-block__count">{t("ocr.rowCount", { n: rows.length })}</span>
        <Button
          size="small"
          className="pc-rows-block__expand"
          icon={<Icon name="expand" />}
          aria-label={`${t("ocr.expandTable")}: ${title}`}
          onClick={() => {
            drag.reset();
            setOpen(true);
          }}
        >
          {t("ocr.expandTable")}
        </Button>
      </div>
      <RowsTable {...props} wide={false} />
      {editable && (
        <Button size="small" style={{ marginTop: 6 }} onClick={addRow}>
          {t("ocr.addRow")}
        </Button>
      )}
      <Modal
        open={open}
        destroyOnHidden
        width="min(1280px, 94vw)"
        className="pc-rows-dialog"
        maskClosable={false}
        title={
          <div className="pc-rows-dialog__bar" data-testid="rows-dialog-bar" {...drag.handle}>
            <span>{title}</span>
            <span className="pc-rows-dialog__hint">{t("ocr.dragHint")}</span>
          </div>
        }
        modalRender={(node) => (
          <div style={{ transform: `translate(${drag.offset.x}px, ${drag.offset.y}px)` }}>{node}</div>
        )}
        onCancel={() => setOpen(false)}
        footer={
          <div className="pc-rows-dialog__foot">
            {editable ? (
              <Button onClick={addRow} icon={<Icon name="plus" />}>
                {t("ocr.addRow")}
              </Button>
            ) : (
              <span />
            )}
            <Button type="primary" onClick={() => setOpen(false)}>
              {t("ocr.tableDone")}
            </Button>
          </div>
        }
      >
        <RowsTable {...props} wide />
      </Modal>
    </div>
  );
}

/** A value shown in a field's place: a list of rows becomes a table and a nested object its
 * own fields, instead of raw JSON text in one input. */
function ValueEditor({
  path,
  name,
  value,
  marks,
  editable,
  onSet,
}: {
  path: Path;
  name: string;
  value: Json;
  marks: Marks;
  editable: boolean;
  onSet: (path: Path, value: Json) => void;
}) {
  if (isTable(value) && (value as Obj[]).length > 0) {
    const rows = value as Obj[];
    const columns = [...new Set(rows.flatMap((r) => Object.keys(r)))].map((c) => ({ key: c, name: c }));
    return (
      <RowsEditor
        path={path}
        title={name}
        columns={columns}
        rows={rows}
        marks={marks}
        editable={editable}
        onSet={onSet}
        onChangeRows={(next) => onSet(path, next)}
      />
    );
  }
  if (isObj(value) && Object.keys(value).length > 0) {
    return (
      <fieldset className="pc-nested" data-path={pathText(path)}>
        <legend>{name}</legend>
        {Object.entries(value).map(([k, v]) => (
          <ValueEditor
            key={k}
            path={[...path, k]}
            name={k}
            value={v ?? null}
            marks={marks}
            editable={editable}
            onSet={onSet}
          />
        ))}
      </fieldset>
    );
  }
  return <FieldInput path={path} name={name} value={value} marks={marks} editable={editable} onSet={onSet} />;
}

/** A header field with its delete button: the input takes the full row, like the template's
 * own fields, and the button sits on the input's baseline. */
const FIELD_ROW = { display: "flex", alignItems: "flex-end", gap: 8 } as const;

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
 * header fields can be added (name required, unique in the group) and deleted. In a
 * template group with header fields, extra fields the template does not define can be
 * added (name trimmed, not a template key or a key already in the group), edited and
 * deleted; they follow the template's fields under their entered names, and template
 * fields cannot be deleted. Missing
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
          const gv = (isObj(root[g.key as never]) ? (root as Obj)[g.key] : {}) as Obj;
          const defined = g.items.map((i) => i.key);
          // Extra header fields (FR-SYS-129): saved or drafted in this group but not defined by
          // the template, shown with their entered names after the template's fields.
          const extras = Object.keys(gv).filter((k) => !defined.includes(k));
          const lastField = g.items.reduce((at, item, i) => (item.kind === "field" ? i : at), -1);
          const ordinary = lastField >= 0 || extras.length > 0;
          const extraFields = extras.map((k) => (
            <div key={`extra-${k}`} style={FIELD_ROW} data-extra-field={k}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <ValueEditor path={[g.key, k]} name={k} value={gv[k] ?? null} marks={marks} editable={editable} onSet={set} />
              </div>
              {editable && (
                <Button
                  size="small"
                  danger
                  aria-label={`${t("ocr.deleteField")}: ${k}`}
                  style={{ marginBottom: 8 }}
                  onClick={() => onChange(removeAt(root, [g.key, k]))}
                >
                  ×
                </Button>
              )}
            </div>
          ));
          return (
            <Card
              key={g.key}
              size="small"
              title={label(g, lang)}
              extra={
                editable && ordinary ? (
                  <AddField existing={[...new Set([...defined, ...Object.keys(gv)])]} onAdd={(n) => set([g.key, n], "")} />
                ) : null
              }
            >
              {lastField < 0 && extraFields}
              {g.items.map((item, idx) =>
                item.kind === "field" ? (
                  <Fragment key={item.key}>
                    <FieldInput
                      path={[g.key, item.key]}
                      name={label(item, lang)}
                      type={item.type}
                      value={getAt(root, [g.key, item.key])}
                      marks={marks}
                      editable={editable}
                      onSet={set}
                    />
                    {idx === lastField && extraFields}
                  </Fragment>
                ) : (
                  <RowsEditor
                    key={item.key}
                    path={[g.key, item.key]}
                    title={label(item, lang)}
                    columns={item.columns ?? []}
                    rows={isTable(gv[item.key]) ? (gv[item.key] as Obj[]) : []}
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
              <ValueEditor path={[gk]} name={gk} value={gv} marks={marks} editable={editable} onSet={set} />
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
              <div key={k} style={FIELD_ROW}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <ValueEditor path={[gk, k]} name={k} value={gv[k] ?? null} marks={marks} editable={editable} onSet={set} />
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
              </div>
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
