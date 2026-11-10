import { Alert, Button, Checkbox, Input, Popconfirm, Select, Tag } from "antd";
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from "react";

import { mergeTemplateEditorLabels, type TemplateEditorLabels } from "./labels";
import { localizeTemplateError } from "./messages";
import {
  columnPath,
  groupPath,
  itemPath,
  parentPath,
  pathDomId,
  removeRemap,
  slugifyKey,
  swapRemap,
  type PathRemap,
} from "./paths";
import {
  COLUMN_ROLES,
  FIELD_ROLES,
  FIELD_TYPES,
  NAME_LANGS,
  TEMPLATE_LIMITS,
  type ConfirmAttr,
  type FieldType,
  type Names,
  type PendingConfirmation,
  type SampleValues,
  type TemplateColumn,
  type TemplateContent,
  type TemplateField,
  type TemplateGroup,
  type TemplateItem,
  type TemplatePathError,
  type TemplateTable,
} from "./types";
import { countTemplate } from "./validate";
import "../components.css";
import "./TemplateEditor.css";

export interface TemplateEditorProps {
  /** Template content {code, name, names?, description, groups}; a draft may be incomplete. */
  value: TemplateContent;
  onChange?: (next: TemplateContent) => void;
  /** Server (or validateTemplateClient) errors; each is shown beside its input and in the summary. */
  errors?: readonly TemplatePathError[];
  /** Sample suggestions awaiting a person (draft `_pending_confirmations`). */
  pendingConfirmations?: readonly PendingConfirmation[];
  /**
   * A decision on a pending suggestion: accept keeps/sets the suggested value, reject (or a manual
   * different choice) does not. The editor emits the value change through onChange first.
   */
  onConfirm?: (path: string, attr: string, accept: boolean) => void;
  /**
   * After a reorder/removal: maps old index paths to new ones (null = removed), so the app can
   * move its errors and pending confirmations with the rows.
   */
  onPathsRemap?: (remap: PathRemap) => void;
  readOnly?: boolean;
  /** Sample values shown beside each field / column (never stored in the template). */
  sampleValues?: SampleValues | null;
  labels?: Partial<TemplateEditorLabels>;
}

// ---------- internal row ids (stable React keys that never enter `value`) ----------

interface IdNode {
  id: string;
  children: IdNode[];
}

let idSeq = 0;
const nextId = () => {
  idSeq += 1;
  return `te${idSeq}`;
};

function fillIds(tree: readonly IdNode[], value: TemplateContent): IdNode[] {
  return (value.groups ?? []).map((g, gi) => {
    const gNode = tree[gi];
    return {
      id: gNode?.id ?? nextId(),
      children: (g.items ?? []).map((item, ii) => {
        const iNode = gNode?.children[ii];
        const cols = item.kind === "table" ? (item.columns ?? []) : [];
        return {
          id: iNode?.id ?? nextId(),
          children: cols.map((_, ci) => iNode?.children[ci] ?? { id: nextId(), children: [] }),
        };
      }),
    };
  });
}

function move<T>(list: readonly T[], from: number, to: number): T[] {
  const next = [...list];
  const [x] = next.splice(from, 1);
  if (x !== undefined) next.splice(to, 0, x);
  return next;
}

const without = <T,>(list: readonly T[], at: number): T[] => list.filter((_, i) => i !== at);

// ---------- defaults ----------

const newField = (): TemplateField => ({
  kind: "field",
  key: "",
  name: "",
  description: "",
  type: "string",
  required: false,
  primary: false,
  role: null,
});
const newColumn = (): TemplateColumn => ({ key: "", name: "", description: "", type: "string", required: false, role: null });
const newTable = (): TemplateTable => ({ kind: "table", key: "", name: "", description: "", columns: [newColumn()] });
const newGroup = (): TemplateGroup => ({ key: "", name: "", description: "", items: [newField()] });

/** Name edit that also fills the key while it is empty or still the slug of the old name. */
function namePatch(entry: { key?: string; name?: string }, name: string): { name: string; key?: string } {
  const key = entry.key ?? "";
  if (key === "" || key === slugifyKey(entry.name ?? "")) return { name, key: slugifyKey(name) };
  return { name };
}

function namesPatch(names: Names | null | undefined, lang: string, text: string): Names | undefined {
  const next: Names = { ...(names ?? {}) };
  if (text === "") delete next[lang as keyof Names];
  else next[lang as keyof Names] = text;
  return Object.keys(next).length ? next : undefined;
}

function applyPatch<T extends object>(entry: T, patch: Partial<Record<string, unknown>>): T {
  const next: Record<string, unknown> = { ...entry, ...patch };
  for (const [k, v] of Object.entries(patch)) if (v === undefined) delete next[k];
  return next as T;
}

const sameValue = (a: unknown, b: unknown) => (a ?? null) === (b ?? null);

function sampleText(v: unknown): string | null {
  if (v === null || v === undefined || v === "") return null;
  return String(v);
}

// ---------- shared context passed down as props ----------

interface Shared {
  labels: TemplateEditorLabels;
  readOnly: boolean;
  id: (path: string) => string;
  errorsAt: (path: string) => string[];
  residual: (path: string, handled: string[]) => string[];
  hasErrorsUnder: (path: string, segs: string[]) => boolean;
  pendingAt: (path: string) => PendingConfirmation[];
  decide: (path: string, attr: string, accept: boolean) => void;
  sample: boolean;
}

function ErrorText({ id, messages }: { id: string; messages: string[] }) {
  if (!messages.length) return null;
  return (
    <div id={id} className="sf-te-error">
      {messages.map((m, i) => (
        <div key={i}>{m}</div>
      ))}
    </div>
  );
}

function TextField({
  s,
  path,
  label,
  value,
  onChange,
  multiline,
  className,
  placeholder,
}: {
  s: Shared;
  path: string;
  label: string;
  value: string | null | undefined;
  onChange: (v: string) => void;
  multiline?: boolean;
  className?: string;
  placeholder?: string;
}) {
  const id = s.id(path);
  const errs = s.errorsAt(path);
  const common = {
    id,
    value: value ?? "",
    readOnly: s.readOnly,
    "aria-label": label,
    "aria-invalid": errs.length ? true : undefined,
    "aria-describedby": errs.length ? `${id}-err` : undefined,
    status: errs.length ? ("error" as const) : undefined,
    placeholder,
  };
  return (
    <div className={`sf-te-cell ${className ?? ""}`}>
      {multiline ? (
        <Input.TextArea {...common} autoSize={{ minRows: 1, maxRows: 6 }} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <Input {...common} onChange={(e) => onChange(e.target.value)} />
      )}
      <ErrorText id={`${id}-err`} messages={errs} />
    </div>
  );
}

function NamesEditor({
  s,
  base,
  names,
  onChange,
}: {
  s: Shared;
  base: string;
  names: Names | null | undefined;
  onChange: (lang: string, text: string) => void;
}) {
  return (
    <fieldset className="sf-te-names">
      <legend>{s.labels.names}</legend>
      {NAME_LANGS.map((lang) => (
        <label key={lang} className="sf-te-names__item">
          <span>{s.labels.nameLang[lang]}</span>
          <TextField
            s={s}
            path={`${base}names.${lang}`}
            label={`${s.labels.names}: ${s.labels.nameLang[lang]}`}
            value={names?.[lang]}
            onChange={(v) => onChange(lang, v)}
          />
        </label>
      ))}
    </fieldset>
  );
}

function MoveButtons({
  s,
  path,
  label,
  index,
  count,
  onMove,
}: {
  s: Shared;
  path: string;
  label: string;
  index: number;
  count: number;
  onMove: (dir: -1 | 1) => void;
}) {
  if (s.readOnly) return null;
  return (
    <div className="sf-te-cell sf-te-cell--move">
      <Button
        id={`${s.id(path)}-up`}
        size="small"
        type="text"
        aria-label={`${s.labels.moveUp}: ${label}`}
        title={s.labels.moveUp}
        disabled={index === 0}
        onClick={() => onMove(-1)}
      >
        ↑
      </Button>
      <Button
        id={`${s.id(path)}-down`}
        size="small"
        type="text"
        aria-label={`${s.labels.moveDown}: ${label}`}
        title={s.labels.moveDown}
        disabled={index >= count - 1}
        onClick={() => onMove(1)}
      >
        ↓
      </Button>
    </div>
  );
}

function describeSuggestion(s: Shared, attr: string, value: unknown, roleLabels: Record<string, string>): string {
  const attrLabel = attr === "required" ? s.labels.required : attr === "primary" ? s.labels.primary : s.labels.role;
  let v: string;
  if (typeof value === "boolean") v = value ? s.labels.yes : s.labels.no;
  else if (value === null || value === undefined) v = s.labels.noRole;
  else v = roleLabels[String(value)] ?? String(value);
  return s.labels.suggested(attrLabel, v);
}

function ConfirmBar({
  s,
  path,
  items,
  roleLabels,
  onAccept,
  onReject,
}: {
  s: Shared;
  path: string;
  items: PendingConfirmation[];
  roleLabels: Record<string, string>;
  onAccept: (p: PendingConfirmation) => void;
  onReject: (p: PendingConfirmation) => void;
}) {
  if (!items.length) return null;
  return (
    <ul className="sf-te-confirm" aria-label={s.labels.toConfirm}>
      {items.map((p) => (
        <li key={`${path}-${p.attr}`} className="sf-te-confirm__item">
          <Tag color="warning">{s.labels.toConfirm}</Tag>
          <span>{describeSuggestion(s, p.attr, p.value, roleLabels)}</span>
          {!s.readOnly && (
            <>
              <Button size="small" onClick={() => onAccept(p)}>
                {s.labels.accept}
              </Button>
              <Button size="small" onClick={() => onReject(p)}>
                {s.labels.reject}
              </Button>
            </>
          )}
        </li>
      ))}
    </ul>
  );
}

function PendingTag({ s, show }: { s: Shared; show: boolean }) {
  if (!show) return null;
  return (
    <Tag color="warning" className="sf-te-pending-tag">
      {s.labels.toConfirm}
    </Tag>
  );
}

interface AttrRowProps {
  s: Shared;
  path: string;
  entry: TemplateField | TemplateColumn;
  isColumn: boolean;
  patch: (p: Record<string, unknown>) => void;
}

/** type / required / primary (fields only) / role controls with their confirmation state. */
function AttrCells({ s, path, entry, isColumn, patch }: AttrRowProps) {
  const pending = s.pendingAt(path);
  const pend = (attr: ConfirmAttr) => pending.find((p) => p.attr === attr);
  const roleLabels: Record<string, string> = isColumn ? s.labels.columnRoles : s.labels.fieldRoles;
  const roles: readonly string[] = isColumn ? COLUMN_ROLES : FIELD_ROLES;

  const change = (attr: ConfirmAttr, v: unknown) => {
    patch({ [attr]: v });
    const p = pend(attr);
    if (p) s.decide(path, attr, sameValue(v, p.value));
  };
  const accept = (p: PendingConfirmation) => {
    const attr = p.attr as ConfirmAttr;
    const ok =
      attr === "role" ? p.value === null || roles.includes(String(p.value)) : typeof p.value === "boolean";
    if (ok && !sameValue((entry as unknown as Record<string, unknown>)[attr], p.value)) patch({ [attr]: p.value });
    s.decide(path, attr, true);
  };
  const reject = (p: PendingConfirmation) => {
    const attr = p.attr as ConfirmAttr;
    if (sameValue((entry as unknown as Record<string, unknown>)[attr], p.value)) patch({ [attr]: attr === "role" ? null : false });
    s.decide(path, attr, false);
  };

  const typeId = s.id(`${path}.type`);
  const roleId = s.id(`${path}.role`);
  const typeErrs = s.errorsAt(`${path}.type`);
  const roleErrs = s.errorsAt(`${path}.role`);
  const reqErrs = s.errorsAt(`${path}.required`);
  const primErrs = s.errorsAt(`${path}.primary`);
  return (
    <>
      <div className="sf-te-cell sf-te-cell--type">
        <Select<FieldType>
          id={typeId}
          aria-label={s.labels.type}
          value={(entry.type ?? "string") as FieldType}
          disabled={s.readOnly}
          virtual={false}
          status={typeErrs.length ? "error" : undefined}
          options={FIELD_TYPES.map((t) => ({ value: t, label: s.labels.types[t] }))}
          onChange={(v) => patch({ type: v })}
          popupMatchSelectWidth={false}
        />
        <ErrorText id={`${typeId}-err`} messages={typeErrs} />
      </div>
      <div className="sf-te-cell sf-te-cell--flags">
        <span className="sf-te-flag">
          <Checkbox
            id={s.id(`${path}.required`)}
            checked={!!entry.required}
            disabled={s.readOnly}
            onChange={(e) => change("required", e.target.checked)}
          >
            {s.labels.required}
          </Checkbox>
          <PendingTag s={s} show={!!pend("required")} />
        </span>
        {!isColumn && (
          <span className="sf-te-flag">
            <Checkbox
              id={s.id(`${path}.primary`)}
              checked={!!(entry as TemplateField).primary}
              disabled={s.readOnly}
              onChange={(e) => change("primary", e.target.checked)}
            >
              {s.labels.primary}
            </Checkbox>
            <PendingTag s={s} show={!!pend("primary")} />
          </span>
        )}
        <ErrorText id={`${s.id(`${path}.flags`)}-err`} messages={[...reqErrs, ...primErrs]} />
      </div>
      <div className="sf-te-cell sf-te-cell--role">
        <Select<string>
          id={roleId}
          aria-label={s.labels.role}
          value={(entry.role ?? "") as string}
          disabled={s.readOnly}
          virtual={false}
          status={roleErrs.length ? "error" : undefined}
          options={[
            { value: "", label: s.labels.noRole },
            ...roles.map((r) => ({ value: r, label: roleLabels[r] ?? r })),
          ]}
          onChange={(v) => change("role", v === "" ? null : v)}
          popupMatchSelectWidth={false}
        />
        <PendingTag s={s} show={!!pend("role")} />
        <ErrorText id={`${roleId}-err`} messages={roleErrs} />
      </div>
      <ConfirmBarSlot>
        <ConfirmBar
          s={s}
          path={path}
          items={pending.filter((p) => p.attr === "required" || p.attr === "primary" || p.attr === "role")}
          roleLabels={roleLabels}
          onAccept={accept}
          onReject={reject}
        />
      </ConfirmBarSlot>
    </>
  );
}

function ConfirmBarSlot({ children }: { children: ReactNode }) {
  return <div className="sf-te-cell sf-te-cell--full">{children}</div>;
}

function SampleCell({ s, text }: { s: Shared; text: string | null }) {
  if (!s.sample) return null;
  return (
    <div className="sf-te-cell sf-te-cell--sample" aria-label={s.labels.sampleValue}>
      <span className="sf-te-sample" title={text ?? undefined}>
        {text ?? "—"}
      </span>
    </div>
  );
}

function MoreToggle({ s, open, onToggle, controls }: { s: Shared; open: boolean; onToggle: () => void; controls: string }) {
  return (
    <Button size="small" type="link" aria-expanded={open} aria-controls={controls} onClick={onToggle}>
      {open ? s.labels.less : s.labels.more}
    </Button>
  );
}

function DetailsArea({
  s,
  base,
  open,
  id,
  entry,
  patch,
}: {
  s: Shared;
  base: string;
  open: boolean;
  id: string;
  entry: { description?: string; names?: Names | null };
  patch: (p: Record<string, unknown>) => void;
}) {
  if (!open) return null;
  return (
    <div id={id} className="sf-te-details">
      <TextField
        s={s}
        path={`${base}description`}
        label={s.labels.description}
        value={entry.description}
        multiline
        className="sf-te-cell--grow"
        onChange={(v) => patch({ description: v })}
      />
      <NamesEditor s={s} base={base} names={entry.names} onChange={(lang, text) => patch({ names: namesPatch(entry.names, lang, text) })} />
    </div>
  );
}

const ENTRY_SEGS = ["key", "name", "description", "names", "type", "required", "primary", "role", "kind"];

function KeyNameCells({
  s,
  path,
  entry,
  patch,
}: {
  s: Shared;
  path: string;
  entry: { key?: string; name?: string };
  patch: (p: Record<string, unknown>) => void;
}) {
  return (
    <>
      <TextField
        s={s}
        path={`${path}.key`}
        label={s.labels.key}
        value={entry.key}
        className="sf-te-cell--key"
        placeholder={s.labels.key}
        onChange={(v) => patch({ key: v })}
      />
      <TextField
        s={s}
        path={`${path}.name`}
        label={s.labels.name}
        value={entry.name}
        className="sf-te-cell--name"
        placeholder={s.labels.name}
        onChange={(v) => patch(namePatch(entry, v))}
      />
    </>
  );
}

// ---------- the editor ----------

const NO_ERRORS: readonly TemplatePathError[] = [];

/** The visible name of a path's last attribute (key, type, names.zh …); unknown ones stay as they are. */
function attrLabel(labels: TemplateEditorLabels, attr: string): string {
  const lang = /^names\.(en|th|zh)$/.exec(attr)?.[1] as keyof TemplateEditorLabels["nameLang"] | undefined;
  if (lang) return `${labels.names}: ${labels.nameLang[lang]}`;
  const known: Record<string, string> = {
    code: labels.code,
    key: labels.key,
    name: labels.name,
    names: labels.names,
    description: labels.description,
    type: labels.type,
    required: labels.required,
    primary: labels.primary,
    role: labels.role,
    columns: labels.columns,
    groups: labels.countGroups,
  };
  return known[attr] ?? attr;
}

/**
 * Structure editor for document templates (FR-TEMPLATE-001/003–005/008, FR-SYS-140): groups,
 * fields row by row, tables column by column. Pure and controlled: no API calls.
 */
export function TemplateEditor({
  value,
  onChange,
  errors: rawErrors = NO_ERRORS,
  pendingConfirmations = [],
  onConfirm,
  onPathsRemap,
  readOnly = false,
  sampleValues,
  labels: labelsIn,
}: TemplateEditorProps) {
  const labels = useMemo(() => mergeTemplateEditorLabels(labelsIn), [labelsIn]);
  const errors = useMemo(
    () => rawErrors.map((e) => ({ ...e, message: localizeTemplateError(e.message, labels.errors, e.path) })),
    [rawErrors, labels],
  );
  const prefix = `sfte${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const [ids, setIds] = useState<IdNode[]>(() => fillIds([], value));
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const focusAfter = useRef<string[] | null>(null);

  useEffect(() => {
    const targets = focusAfter.current;
    if (!targets) return;
    focusAfter.current = null;
    for (const t of targets) {
      const el = document.getElementById(t) as HTMLButtonElement | null;
      if (el && !el.disabled) {
        el.focus();
        return;
      }
    }
  });

  const groups = value.groups ?? [];
  const counts = countTemplate(value);
  const atFieldLimit = counts.fieldsAndColumns >= TEMPLATE_LIMITS.fieldsAndColumns;
  const atGroupLimit = counts.groups >= TEMPLATE_LIMITS.groups || atFieldLimit;
  const atTableLimit = counts.tables >= TEMPLATE_LIMITS.tables || atFieldLimit;

  const errorMap = useMemo(() => {
    const m = new Map<string, string[]>();
    for (const e of errors) m.set(e.path, [...(m.get(e.path) ?? []), e.message]);
    return m;
  }, [errors]);

  const id = (path: string) => pathDomId(prefix, path);
  const shared: Shared = {
    labels,
    readOnly,
    id,
    errorsAt: (path) => errorMap.get(path) ?? [],
    residual: (path, handled) =>
      errors
        .filter((e) => {
          if (e.path === path) return true;
          if (!e.path.startsWith(`${path}.`)) return false;
          const rest = e.path.slice(path.length + 1);
          const seg = rest.split(/[.[]/)[0] ?? "";
          if (!handled.includes(seg)) return true;
          return rest === seg && (seg === "items" || seg === "columns" || seg === "names");
        })
        .map((e) => (e.path === path ? e.message : `${e.path.slice(path.length + 1)}: ${e.message}`)),
    hasErrorsUnder: (path, segs) => errors.some((e) => segs.some((seg) => e.path.startsWith(`${path}.${seg}`))),
    pendingAt: (path) => pendingConfirmations.filter((p) => p.path === path),
    decide: (path, attr, accept) => onConfirm?.(path, attr, accept),
    sample: !!sampleValues,
  };

  // ----- value updates -----
  const emit = (next: TemplateContent) => onChange?.(next);
  const structural = (next: TemplateContent, mutate: (tree: IdNode[]) => IdNode[], remap?: PathRemap) => {
    setIds(mutate(fillIds(ids, value)));
    emit(next);
    if (remap) onPathsRemap?.(remap);
  };
  const withGroups = (gs: TemplateGroup[]): TemplateContent => ({ ...value, groups: gs });
  const patchRoot = (p: Record<string, unknown>) => emit(applyPatch(value, p));
  const patchGroup = (gi: number, p: Record<string, unknown>) =>
    emit(withGroups(groups.map((g, i) => (i === gi ? applyPatch(g, p) : g))));
  const setItems = (gi: number, items: TemplateItem[]) =>
    withGroups(groups.map((g, i) => (i === gi ? { ...g, items } : g)));
  const itemsOf = (gi: number) => groups[gi]?.items ?? [];
  const patchItem = (gi: number, ii: number, p: Record<string, unknown>) =>
    emit(setItems(gi, itemsOf(gi).map((it, i) => (i === ii ? applyPatch(it, p) : it))));
  const columnsOf = (gi: number, ii: number) => {
    const it = itemsOf(gi)[ii];
    return it && it.kind === "table" ? (it.columns ?? []) : [];
  };
  const setColumns = (gi: number, ii: number, columns: TemplateColumn[]) =>
    setItems(gi, itemsOf(gi).map((it, i) => (i === ii && it.kind === "table" ? { ...it, columns } : it)));
  const patchColumn = (gi: number, ii: number, ci: number, p: Record<string, unknown>) =>
    emit(setColumns(gi, ii, columnsOf(gi, ii).map((c, i) => (i === ci ? applyPatch(c, p) : c))));

  const focusMoved = (path: string, dir: -1 | 1) => {
    const base = id(path);
    focusAfter.current = dir < 0 ? [`${base}-up`, `${base}-down`] : [`${base}-down`, `${base}-up`];
  };

  const addGroup = () =>
    structural(withGroups([...groups, newGroup()]), (t) => [
      ...t,
      { id: nextId(), children: [{ id: nextId(), children: [] }] },
    ]);
  const removeGroup = (gi: number) =>
    structural(withGroups(without(groups, gi)), (t) => without(t, gi), removeRemap("groups", gi));
  const moveGroup = (gi: number, dir: -1 | 1) => {
    const to = gi + dir;
    if (to < 0 || to >= groups.length) return;
    focusMoved(groupPath(to), dir);
    structural(withGroups(move(groups, gi, to)), (t) => move(t, gi, to), swapRemap("groups", gi, to));
  };
  const mapGroupNode = (t: IdNode[], gi: number, fn: (children: IdNode[]) => IdNode[]) =>
    t.map((n, i) => (i === gi ? { ...n, children: fn(n.children) } : n));

  const addItem = (gi: number, kind: "field" | "table") =>
    structural(setItems(gi, [...itemsOf(gi), kind === "field" ? newField() : newTable()]), (t) =>
      mapGroupNode(t, gi, (c) => [...c, { id: nextId(), children: kind === "table" ? [{ id: nextId(), children: [] }] : [] }]),
    );
  const removeItem = (gi: number, ii: number) =>
    structural(
      setItems(gi, without(itemsOf(gi), ii)),
      (t) => mapGroupNode(t, gi, (c) => without(c, ii)),
      removeRemap(`${groupPath(gi)}.items`, ii),
    );
  const moveItem = (gi: number, ii: number, dir: -1 | 1) => {
    const to = ii + dir;
    if (to < 0 || to >= itemsOf(gi).length) return;
    focusMoved(itemPath(gi, to), dir);
    structural(
      setItems(gi, move(itemsOf(gi), ii, to)),
      (t) => mapGroupNode(t, gi, (c) => move(c, ii, to)),
      swapRemap(`${groupPath(gi)}.items`, ii, to),
    );
  };
  const mapItemNode = (t: IdNode[], gi: number, ii: number, fn: (children: IdNode[]) => IdNode[]) =>
    mapGroupNode(t, gi, (c) => c.map((n, i) => (i === ii ? { ...n, children: fn(n.children) } : n)));
  const addColumn = (gi: number, ii: number) =>
    structural(setColumns(gi, ii, [...columnsOf(gi, ii), newColumn()]), (t) =>
      mapItemNode(t, gi, ii, (c) => [...c, { id: nextId(), children: [] }]),
    );
  const removeColumn = (gi: number, ii: number, ci: number) =>
    structural(
      setColumns(gi, ii, without(columnsOf(gi, ii), ci)),
      (t) => mapItemNode(t, gi, ii, (c) => without(c, ci)),
      removeRemap(`${itemPath(gi, ii)}.columns`, ci),
    );
  const moveColumn = (gi: number, ii: number, ci: number, dir: -1 | 1) => {
    const to = ci + dir;
    if (to < 0 || to >= columnsOf(gi, ii).length) return;
    focusMoved(columnPath(gi, ii, to), dir);
    structural(
      setColumns(gi, ii, move(columnsOf(gi, ii), ci, to)),
      (t) => mapItemNode(t, gi, ii, (c) => move(c, ci, to)),
      swapRemap(`${itemPath(gi, ii)}.columns`, ci, to),
    );
  };

  const toggle = (key: string) =>
    setOpen((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  const isOpen = (key: string, path: string) =>
    open.has(key) || shared.hasErrorsUnder(path, ["description", "names"]);

  // ----- summary helpers -----
  const focusPath = (path: string) => {
    let p: string | null = path;
    while (p) {
      const el = document.getElementById(id(p));
      if (el) {
        el.scrollIntoView?.({ block: "center", behavior: "smooth" });
        el.focus({ preventScroll: true });
        return;
      }
      p = parentPath(p);
    }
  };
  const describePath = (path: string): string => {
    const crumbs: string[] = [];
    const m = /^groups\[(\d+)\](?:\.items\[(\d+)\](?:\.columns\[(\d+)\])?)?(?:\.(.+))?$/.exec(path);
    if (!m) return path === "groups" ? labels.countGroups : path === "$" ? labels.templateSection : attrLabel(labels, path);
    const gi = Number(m[1]);
    const g = groups[gi];
    crumbs.push(g?.name || g?.key || labels.group(gi + 1));
    if (m[2] !== undefined) {
      const ii = Number(m[2]);
      const it = g?.items?.[ii];
      crumbs.push(it?.name || it?.key || (it?.kind === "table" ? labels.table(ii + 1) : labels.field(ii + 1)));
      if (m[3] !== undefined) {
        const ci = Number(m[3]);
        const col = it?.kind === "table" ? it.columns?.[ci] : undefined;
        crumbs.push(col?.name || col?.key || labels.column(ci + 1));
      }
    }
    if (m[4]) crumbs.push(attrLabel(labels, m[4]));
    return crumbs.join(" › ");
  };

  const sampleFor = (g: TemplateGroup, it: TemplateItem): string | null => {
    if (!sampleValues || it.kind !== "field") return null;
    const v = sampleValues[`${g.key}.${it.key}`];
    return Array.isArray(v) ? null : sampleText(v);
  };
  const columnSample = (g: TemplateGroup, t: TemplateTable, ci: number): string | null => {
    if (!sampleValues) return null;
    const rows = sampleValues[`${g.key}.${t.key}`];
    if (!Array.isArray(rows)) return null;
    const col = t.columns?.[ci];
    const vals: string[] = [];
    for (const row of rows) {
      const v = Array.isArray(row) ? row[ci] : col ? (row as Record<string, unknown>)[col.key] : undefined;
      const text = sampleText(v);
      if (text !== null && !vals.includes(text)) vals.push(text);
      if (vals.length >= 3) break;
    }
    return vals.length ? vals.join(" · ") : null;
  };

  const limitHint = (on: boolean) => (on ? labels.limitReached : undefined);
  const rootResidual = errors.filter((e) => e.path === "groups" || e.path === "$" || !/^(groups\[|code$|name$|description$|names)/.test(e.path));

  return (
    <div className={`sf-te${readOnly ? " sf-te--readonly" : ""}`}>
      <div className="sf-te-counts" aria-live="polite">
        <Tag color={counts.groups > TEMPLATE_LIMITS.groups ? "error" : counts.groups === TEMPLATE_LIMITS.groups ? "warning" : "default"}>
          {labels.countGroups} {counts.groups}/{TEMPLATE_LIMITS.groups}
        </Tag>
        <Tag
          color={
            counts.fieldsAndColumns > TEMPLATE_LIMITS.fieldsAndColumns
              ? "error"
              : counts.fieldsAndColumns === TEMPLATE_LIMITS.fieldsAndColumns
                ? "warning"
                : "default"
          }
        >
          {labels.countFields} {counts.fieldsAndColumns}/{TEMPLATE_LIMITS.fieldsAndColumns}
        </Tag>
        <Tag color={counts.tables > TEMPLATE_LIMITS.tables ? "error" : counts.tables === TEMPLATE_LIMITS.tables ? "warning" : "default"}>
          {labels.countTables} {counts.tables}/{TEMPLATE_LIMITS.tables}
        </Tag>
      </div>

      {errors.length > 0 && (
        <Alert
          type="error"
          showIcon
          className="sf-te-summary"
          message={labels.errorSummary(errors.length)}
          description={
            <ul className="sf-te-summary__list">
              {errors.map((e, i) => (
                <li key={`${e.path}-${i}`}>
                  <Button type="link" size="small" className="sf-te-summary__link" onClick={() => focusPath(e.path)}>
                    {describePath(e.path)}
                  </Button>
                  <span>: {e.message}</span>
                </li>
              ))}
            </ul>
          }
        />
      )}
      {pendingConfirmations.length > 0 && (
        <Alert
          type="warning"
          showIcon
          className="sf-te-summary"
          message={labels.pendingSummary(pendingConfirmations.length)}
          description={
            <ul className="sf-te-summary__list">
              {pendingConfirmations.map((p, i) => (
                <li key={`${p.path}-${p.attr}-${i}`}>
                  <Button type="link" size="small" className="sf-te-summary__link" onClick={() => focusPath(p.path)}>
                    {describePath(p.path)}
                  </Button>
                  <span>: {p.attr === "required" ? labels.required : p.attr === "primary" ? labels.primary : labels.role}</span>
                </li>
              ))}
            </ul>
          }
        />
      )}

      <section className="sf-te-head" aria-label={labels.templateSection}>
        <div className="sf-te-row">
          <label className="sf-te-labelled sf-te-cell--key">
            <span>{labels.code}</span>
            <TextField s={shared} path="code" label={labels.code} value={value.code} onChange={(v) => patchRoot({ code: v })} />
          </label>
          <label className="sf-te-labelled sf-te-cell--name">
            <span>{labels.name}</span>
            <TextField s={shared} path="name" label={labels.name} value={value.name} onChange={(v) => patchRoot({ name: v })} />
          </label>
        </div>
        <label className="sf-te-labelled">
          <span>{labels.description}</span>
          <TextField
            s={shared}
            path="description"
            label={labels.description}
            value={value.description}
            multiline
            onChange={(v) => patchRoot({ description: v })}
          />
        </label>
        {/* No language names for the template itself: they are not part of a version
            (only name/description/groups are), so an edit there would be dropped on activation. */}
        <ErrorText id={`${id("groups")}-err`} messages={rootResidual.map((e) => e.message)} />
      </section>

      {groups.length === 0 && <p className="sf-te-empty">{labels.emptyGroups}</p>}

      {groups.map((g, gi) => {
        const gp = groupPath(gi);
        const gNode = ids[gi];
        const gKey = gNode?.id ?? `g${gi}`;
        const gLabel = g.name || g.key || labels.group(gi + 1);
        const items = g.items ?? [];
        const gResidual = shared.residual(gp, ["key", "name", "description", "names", "items"]);
        const gOpen = isOpen(gKey, gp);
        return (
          <section key={gKey} id={id(gp)} tabIndex={-1} className="sf-te-group" aria-label={labels.group(gi + 1)}>
            <div className="sf-te-group__head">
              <span className="sf-te-group__title">{labels.group(gi + 1)}</span>
              <MoveButtons s={shared} path={gp} label={gLabel} index={gi} count={groups.length} onMove={(d) => moveGroup(gi, d)} />
              <KeyNameCells s={shared} path={gp} entry={g} patch={(p) => patchGroup(gi, p)} />
              <div className="sf-te-cell sf-te-cell--actions">
                <MoreToggle s={shared} open={gOpen} onToggle={() => toggle(gKey)} controls={`${id(gp)}-details`} />
                {!readOnly && (
                  <Popconfirm
                    title={labels.removeConfirm}
                    okText={labels.confirmOk}
                    cancelText={labels.cancel}
                    onConfirm={() => removeGroup(gi)}
                  >
                    <Button size="small" danger aria-label={`${labels.removeGroup}: ${gLabel}`}>
                      {labels.removeGroup}
                    </Button>
                  </Popconfirm>
                )}
              </div>
            </div>
            <DetailsArea s={shared} base={`${gp}.`} open={gOpen} id={`${id(gp)}-details`} entry={g} patch={(p) => patchGroup(gi, p)} />
            <ErrorText id={`${id(gp)}-err`} messages={gResidual} />

            <div className="sf-te-items">
              {items.map((it, ii) => {
                const ip = itemPath(gi, ii);
                const iNode = gNode?.children[ii];
                const iKey = iNode?.id ?? `i${gi}-${ii}`;
                const iOpen = isOpen(iKey, ip);
                const isTable = it.kind === "table";
                const iLabel = it.name || it.key || (isTable ? labels.table(ii + 1) : labels.field(ii + 1));
                const iResidual = shared.residual(ip, isTable ? [...ENTRY_SEGS, "columns"] : ENTRY_SEGS);
                if (it.kind !== "table") {
                  const f = it as TemplateField;
                  return (
                    <div key={iKey} id={id(ip)} tabIndex={-1} className="sf-te-item sf-te-item--field" role="group" aria-label={iLabel}>
                      <div className="sf-te-row">
                        <MoveButtons s={shared} path={ip} label={iLabel} index={ii} count={items.length} onMove={(d) => moveItem(gi, ii, d)} />
                        <KeyNameCells s={shared} path={ip} entry={f} patch={(p) => patchItem(gi, ii, p)} />
                        <AttrCells s={shared} path={ip} entry={f} isColumn={false} patch={(p) => patchItem(gi, ii, p)} />
                        <SampleCell s={shared} text={sampleFor(g, f)} />
                        <div className="sf-te-cell sf-te-cell--actions">
                          <MoreToggle s={shared} open={iOpen} onToggle={() => toggle(iKey)} controls={`${id(ip)}-details`} />
                          {!readOnly && (
                            <Button size="small" type="text" danger aria-label={`${labels.remove}: ${iLabel}`} onClick={() => removeItem(gi, ii)}>
                              {labels.remove}
                            </Button>
                          )}
                        </div>
                      </div>
                      <DetailsArea s={shared} base={`${ip}.`} open={iOpen} id={`${id(ip)}-details`} entry={f} patch={(p) => patchItem(gi, ii, p)} />
                      <ErrorText id={`${id(ip)}-err`} messages={iResidual} />
                    </div>
                  );
                }
                const t = it;
                const cols = t.columns ?? [];
                return (
                  <div key={iKey} id={id(ip)} tabIndex={-1} className="sf-te-item sf-te-item--table" role="group" aria-label={iLabel}>
                    <div className="sf-te-row">
                      <MoveButtons s={shared} path={ip} label={iLabel} index={ii} count={items.length} onMove={(d) => moveItem(gi, ii, d)} />
                      <span className="sf-te-badge">{labels.table(ii + 1)}</span>
                      <KeyNameCells s={shared} path={ip} entry={t} patch={(p) => patchItem(gi, ii, p)} />
                      <div className="sf-te-cell sf-te-cell--actions">
                        <MoreToggle s={shared} open={iOpen} onToggle={() => toggle(iKey)} controls={`${id(ip)}-details`} />
                        {!readOnly && (
                          <Popconfirm
                            title={labels.removeConfirm}
                            okText={labels.confirmOk}
                            cancelText={labels.cancel}
                            onConfirm={() => removeItem(gi, ii)}
                          >
                            <Button size="small" danger aria-label={`${labels.removeTable}: ${iLabel}`}>
                              {labels.removeTable}
                            </Button>
                          </Popconfirm>
                        )}
                      </div>
                    </div>
                    <DetailsArea s={shared} base={`${ip}.`} open={iOpen} id={`${id(ip)}-details`} entry={t} patch={(p) => patchItem(gi, ii, p)} />
                    <ErrorText id={`${id(ip)}-err`} messages={iResidual} />
                    <div className="sf-te-columns" role="list" aria-label={`${labels.columns}: ${iLabel}`}>
                      {cols.map((c, ci) => {
                        const cp = columnPath(gi, ii, ci);
                        const cKey = iNode?.children[ci]?.id ?? `c${gi}-${ii}-${ci}`;
                        const cOpen = isOpen(cKey, cp);
                        const cLabel = c.name || c.key || labels.column(ci + 1);
                        const cResidual = shared.residual(cp, ENTRY_SEGS);
                        return (
                          <div key={cKey} id={id(cp)} tabIndex={-1} className="sf-te-item sf-te-item--column" role="listitem" aria-label={cLabel}>
                            <div className="sf-te-row">
                              <MoveButtons s={shared} path={cp} label={cLabel} index={ci} count={cols.length} onMove={(d) => moveColumn(gi, ii, ci, d)} />
                              <KeyNameCells s={shared} path={cp} entry={c} patch={(p) => patchColumn(gi, ii, ci, p)} />
                              <AttrCells s={shared} path={cp} entry={c} isColumn patch={(p) => patchColumn(gi, ii, ci, p)} />
                              <SampleCell s={shared} text={columnSample(g, t, ci)} />
                              <div className="sf-te-cell sf-te-cell--actions">
                                <MoreToggle s={shared} open={cOpen} onToggle={() => toggle(cKey)} controls={`${id(cp)}-details`} />
                                {!readOnly && (
                                  <Button
                                    size="small"
                                    type="text"
                                    danger
                                    aria-label={`${labels.remove}: ${cLabel}`}
                                    onClick={() => removeColumn(gi, ii, ci)}
                                  >
                                    {labels.remove}
                                  </Button>
                                )}
                              </div>
                            </div>
                            <DetailsArea
                              s={shared}
                              base={`${cp}.`}
                              open={cOpen}
                              id={`${id(cp)}-details`}
                              entry={c}
                              patch={(p) => patchColumn(gi, ii, ci, p)}
                            />
                            <ErrorText id={`${id(cp)}-err`} messages={cResidual} />
                          </div>
                        );
                      })}
                    </div>
                    {!readOnly && (
                      <Button
                        size="small"
                        className="sf-te-add"
                        disabled={atFieldLimit}
                        title={limitHint(atFieldLimit)}
                        onClick={() => addColumn(gi, ii)}
                      >
                        {labels.addColumn}
                      </Button>
                    )}
                  </div>
                );
              })}
            </div>
            {!readOnly && (
              <div className="sf-te-actions">
                <Button size="small" disabled={atFieldLimit} title={limitHint(atFieldLimit)} onClick={() => addItem(gi, "field")}>
                  {labels.addField}
                </Button>
                <Button size="small" disabled={atTableLimit} title={limitHint(atTableLimit)} onClick={() => addItem(gi, "table")}>
                  {labels.addTable}
                </Button>
              </div>
            )}
          </section>
        );
      })}

      {!readOnly && (
        <div className="sf-te-actions">
          <Button type="dashed" disabled={atGroupLimit} title={limitHint(atGroupLimit)} onClick={addGroup}>
            {labels.addGroup}
          </Button>
          {(atGroupLimit || atFieldLimit || atTableLimit) && <span className="sf-te-hint">{labels.limitReached}</span>}
        </div>
      )}
    </div>
  );
}
