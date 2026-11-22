import { Alert, Button, Checkbox, Empty, Form, Input, InputNumber, Popconfirm, Radio, Select, Spin, Switch, Tabs, Tag } from "antd";
import { useEffect, useId, useMemo, useReducer, useState, type ReactNode } from "react";

import { ChartRenderer } from "../ChartRenderer/ChartRenderer";
import type { ChartLabels } from "../ChartRenderer/labels";
import type { ReportGridLabels } from "../ReportGrid/CardFrame";
import { ReportGrid } from "../ReportGrid/ReportGrid";
import { CHART_TYPES, REPORT_PALETTES, type ChartType, type DesignerSource, type QueryResult, type ReportCard, type ReportCardData, type ReportCardStyle, type ReportConfig } from "../reportTypes";
import { mergeReportDesignerLabels, type ReportDesignerLabels } from "./labels";
import { localizeReportError } from "./messages";
import {
  addCard,
  AGGS,
  applyLayouts,
  bindTemplate,
  defaultCardData,
  changeType,
  fieldOptions,
  groupProblems,
  localName,
  pruneConfirmed,
  REPORT_LIMITS,
  removeCard,
  setGrain,
  setVersions,
  TIME_GRAINS,
  updateCard,
  usedPaths,
  type Agg,
  type DesignerField,
  type DesignerFields,
  type DesignerTemplate,
  type ReportProblem,
  type TimeGrain,
} from "./model";
import "../components.css";
import "./ReportDesigner.css";
import { CardAppearance, ContentPanel, FiltersEditor, PageAppearance, PageFilters, filterFields, v2Labels } from "./V2Panels";
import { RawFields, SqlBinding, sqlLabels, type SourceQuery, type SourceTables } from "./DataPanels";

export interface ReportDesignerProps {
  /** The page configuration being designed (a draft may be incomplete). */
  value: ReportConfig;
  onChange?: (next: ReportConfig) => void;
  /** Templates a card may bind (the report catalog). */
  templates: readonly DesignerTemplate[];
  sources?: readonly DesignerSource[];
  querySource?: SourceQuery;
  loadTables?: SourceTables;
  onPreviewPage?: (cardId: string, page: number) => void;
  /** Grains and fields of the chosen versions of a template; cached per template + versions. */
  loadFields: (templateId: number, versionIds: number[]) => Promise<DesignerFields>;
  /** The latest preview (real data in the caller's scope, or synthetic for admin). */
  preview?: QueryResult | null;
  previewLoading?: boolean;
  /** The preview was made from an older configuration. */
  previewStale?: boolean;
  /** Problems of the stored draft (or of a refused publication). */
  errors?: readonly ReportProblem[];
  /** The problems belong to an older configuration than the one on screen. */
  errorsStale?: boolean;
  readOnly?: boolean;
  /** UI language for field names ("en" | "th" | "zh"); default names otherwise. */
  lang?: string;
  /** BCP 47 locale for chart ticks. */
  locale?: string;
  labels?: Partial<ReportDesignerLabels>;
  chartLabels?: Partial<ChartLabels>;
  gridLabels?: Partial<ReportGridLabels>;
  onUpload?: (file: File, signal: AbortSignal) => Promise<string>;
  loadAsset?: (id: string, signal: AbortSignal) => Promise<Blob>;
  embedOrigins?: readonly string[];
}

function ChartTypeIcon({ type }: { type: ChartType }) {
  const shapes: Record<ChartType, ReactNode> = {
    bar: <><path d="M4 20h16" /><rect x="5" y="11" width="3" height="6" rx="1" /><rect x="10.5" y="5" width="3" height="12" rx="1" /><rect x="16" y="8" width="3" height="9" rx="1" /></>,
    line: <><path d="M4 4v16h16M6 15l4-5 4 3 5-7" /></>,
    pie: <><path d="M11 3a9 9 0 1 0 10 10H11Z" /><path d="M14 3.5V10h6.5A8 8 0 0 0 14 3.5Z" /></>,
    donut: <><circle cx="12" cy="12" r="8.5" /><circle cx="12" cy="12" r="4" /><path d="M12 3.5V8m0 8v4.5" /></>,
    metric: <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M7 10h4m-4 4h7m2-4h1" /></>,
    table: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="M3 9h18M3 14h18M9 9v11M15 9v11" /></>,
    image: <><rect x="3" y="4" width="18" height="16" rx="2" /><circle cx="8" cy="9" r="2" /><path d="m4 18 5-5 4 3 4-6 4 8" /></>,
    html: <><rect x="3" y="4" width="18" height="16" rx="2" /><path d="m9 9-3 3 3 3m6-6 3 3-3 3m-2-8-2 10" /></>,
  };
  return (
    <svg className={`sf-rd-type-icon sf-rd-type-icon--${type}`} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" focusable="false">
      {shapes[type]}
    </svg>
  );
}

type FieldsEntry = { status: "loading" } | { status: "ok"; data: DesignerFields } | { status: "error"; error: unknown };

function fieldsKey(templateId: number | null | undefined, ids: readonly number[] | null | undefined): string | null {
  if (!templateId || !ids?.length) return null;
  return `${templateId}:${[...ids].sort((a, b) => a - b).join(",")}`;
}

/** The catalog of one card's versions, loaded once per template + version set. */
function useCardFields(
  cache: Map<string, FieldsEntry>,
  loadFields: ReportDesignerProps["loadFields"],
  data: ReportCardData | null | undefined,
): { entry: FieldsEntry | null; retry: () => void } {
  const [tick, force] = useReducer((n: number) => n + 1, 0);
  const templateId = data?.template_id ?? null;
  const ids = useMemo(() => [...(data?.template_version_ids ?? [])].sort((a, b) => a - b), [data?.template_version_ids]);
  const key = fieldsKey(templateId, ids);
  useEffect(() => {
    if (!key || !templateId || cache.has(key)) return;
    cache.set(key, { status: "loading" });
    force();
    loadFields(templateId, ids).then(
      (d) => {
        cache.set(key, { status: "ok", data: d });
        force();
      },
      (error: unknown) => {
        cache.set(key, { status: "error", error });
        force();
      },
    );
  }, [key, tick, cache, loadFields, templateId, ids]);
  if (data?.source_id?.startsWith("postgres:")) return {
    entry: data.result_fields?.length ? { status: "ok", data: { grains: [], fields: data.result_fields.map((f) => ({ path: f.key, name: f.label, type: f.type, grain: "document", compatible: true, versions: [] })) } } : null,
    retry: () => {},
  };
  return {
    entry: key ? (cache.get(key) ?? { status: "loading" }) : null,
    retry: () => {
      if (key) cache.delete(key);
      force();
    },
  };
}

interface Ctx {
  labels: ReportDesignerLabels;
  readOnly: boolean;
  lang?: string;
  /** Localized problems at a card-relative path (exact, or an index / sub-path of it). */
  at: (...paths: string[]) => string[];
  id: (name: string) => string;
}

function Field({ ctx, label, paths, htmlFor, help, children, warn }: { ctx: Ctx; label: ReactNode; paths?: string[]; htmlFor?: string; help?: ReactNode; warn?: string | null; children: ReactNode }) {
  const errs = paths ? ctx.at(...paths) : [];
  const message = errs.length ? errs.join(" · ") : (warn ?? help);
  return (
    <Form.Item
      label={label}
      htmlFor={htmlFor}
      validateStatus={errs.length ? "error" : warn ? "warning" : undefined}
      help={message || undefined}
      className="sf-rd-field"
    >
      {children}
    </Form.Item>
  );
}

function fieldLabel(f: DesignerField, ctx: Ctx): string {
  const type = ctx.labels.fieldTypes[f.type] ?? f.type;
  const base = `${localName(f, ctx.lang)} · ${type}`;
  return f.compatible ? base : `${base} (${ctx.labels.fieldIncompatible})`;
}

function FieldSelect({
  ctx,
  id,
  label,
  value,
  options,
  onChange,
  allowClear,
  status,
}: {
  ctx: Ctx;
  id: string;
  label: string;
  value: string | null | undefined;
  options: DesignerField[];
  onChange: (path: string | null) => void;
  allowClear?: boolean;
  status?: "error" | "warning";
}) {
  return (
    <Select<string>
      id={id}
      aria-label={label}
      value={value ?? undefined}
      placeholder={allowClear ? ctx.labels.none : ctx.labels.chooseField}
      allowClear={allowClear}
      disabled={ctx.readOnly}
      virtual={false}
      status={status}
      showSearch
      optionFilterProp="label"
      options={options.map((f) => ({ value: f.path, label: fieldLabel(f, ctx), title: f.path, disabled: !f.compatible }))}
      onChange={(v) => onChange(v ?? null)}
      style={{ width: "100%" }}
    />
  );
}

/** A selected path that the options do not offer (other versions or grain). */
function missing(value: string | null | undefined, options: DesignerField[], ctx: Ctx): string | null {
  return value && !options.some((f) => f.path === value && f.compatible) ? ctx.labels.fieldUnavailable : null;
}

function DataTab({
  card,
  ctx,
  templates,
  sources,
  querySource,
  loadTables,
  fields,
  pagePaths,
  onCard,
}: {
  card: ReportCard;
  ctx: Ctx;
  templates: readonly DesignerTemplate[];
  sources: readonly DesignerSource[];
  querySource?: SourceQuery;
  loadTables?: SourceTables;
  fields: { entry: FieldsEntry | null; retry: () => void };
  pagePaths: string[];
  onCard: (next: ReportCard) => void;
}) {
  const l = ctx.labels;
  const data = card.data ?? {};
  const sql = !!data.query_mode || (data.source_id?.startsWith("postgres:") ?? false);
  const sl = sqlLabels(ctx.lang);
  const databases = sources.filter((s) => s.kind === "postgresql" && s.enabled !== false && s.id.startsWith("postgres:"));
  const set = (patch: Partial<ReportCardData>) => {
    const next = { ...data, ...patch };
    const confirmed = new Set([...usedPaths(next), ...pagePaths]);
    onCard({ ...card, data: { ...next, confirmed_paths: (next.confirmed_paths ?? []).filter((p) => confirmed.has(p)) } });
  };
  const template = templates.find((t) => t.template_id === data.template_id);
  const templateOptions = templates
    .filter((t) => t.usable || t.template_id === data.template_id)
    .map((t) => ({
      value: t.template_id,
      label: `${t.name} (${t.code}) · ${l.scopes[t.scope]}${t.usable ? "" : ` · ${l.templateKept}`}`,
    }));
  const versionIds = data.template_version_ids ?? [];
  const catalog = fields.entry?.status === "ok" ? fields.entry.data : null;
  const all = catalog?.fields ?? [];
  const agg = (data.measure?.agg ?? "sum") as Agg;
  const kind = data.dimension?.kind ?? "none";
  const isMetric = card.type === "metric";
  const noSeries = isMetric || card.type === "pie" || card.type === "donut";
  const grainValue = data.grain === "table" ? `table:${data.table_key ?? ""}` : data.grain === "document" ? "document" : undefined;

  const measureOpts = fieldOptions(all, data, "measure");
  const dimOpts = fieldOptions(all, data, kind === "date" ? "dimension-date" : "dimension-category");
  const seriesOpts = fieldOptions(all, data, "series").filter((f) => f.path !== data.dimension?.path);
  const dateOpts = fieldOptions(all, data, "date");
  const unitOpts = fieldOptions(all, data, "unit");
  const used = [...new Set([...usedPaths(data), ...pagePaths])];
  const nameOf = (path: string) => {
    const f = all.find((x) => x.path === path);
    if (f) return `${localName(f, ctx.lang)} (${path})`;
    const g = catalog?.grains.find((x) => x.table_key === path);
    return g ? `${localName({ name: g.name, names: g.names, path }, ctx.lang)} (${path})` : path;
  };

  return (
    <div className="sf-rd-tab">
      <Field ctx={ctx} label={sl.source} paths={["data.source_id"]} help={!databases.length ? sl.noDatabases : undefined}>
        <Select aria-label={sl.source} value={sql ? data.source_id ?? undefined : "template"} placeholder={sl.source} disabled={ctx.readOnly} virtual={false} showSearch optionFilterProp="label"
          options={[{ value: "template", label: sl.template }, { label: sl.relational, options: databases.map((s) => ({ value: s.id, label: `${s.name} · PostgreSQL` })) }]}
          onChange={(source_id: string) => onCard({ ...card, data: source_id === "template" ? defaultCardData(card.type) : { source_id, query_mode: sql ? data.query_mode ?? "sql" : "table", sql: "", result_fields: [], display_fields: [], page_size: data.page_size ?? 20 } })} style={{ width: "100%" }} />
      </Field>
      {sql ? <>
        <SqlBinding key={`${card.id}:${data.source_id}`} card={card} onCard={onCard} querySource={querySource} loadTables={loadTables} lang={ctx.lang} readOnly={ctx.readOnly} />
      </> : <>
      <Field ctx={ctx} label={l.template} htmlFor={ctx.id("template")} paths={["data.template_id"]}>
        <Select<number>
          id={ctx.id("template")}
          aria-label={l.template}
          value={data.template_id ?? undefined}
          placeholder={l.templatePlaceholder}
          disabled={ctx.readOnly}
          virtual={false}
          showSearch
          optionFilterProp="label"
          options={templateOptions}
          onChange={(tid) => {
            const t = templates.find((x) => x.template_id === tid);
            const pick = t?.versions.find((v) => v.current) ?? [...(t?.versions ?? [])].sort((a, b) => b.version - a.version)[0];
            onCard(bindTemplate(card, tid, pick ? [pick.id] : []));
          }}
          style={{ width: "100%" }}
        />
      </Field>
      {template && (
        <Field ctx={ctx} label={l.versions} paths={["data.template_version_ids"]} help={l.versionsHelp}>
          <Checkbox.Group
            className="sf-rd-versions"
            aria-label={l.versions}
            disabled={ctx.readOnly}
            value={versionIds}
            onChange={(ids) => onCard(setVersions(card, (ids as number[]).slice().sort((a, b) => a - b)))}
            options={[...template.versions]
              .sort((a, b) => b.version - a.version)
              .map((v) => ({
                value: v.id,
                label: (
                  <span>
                    {l.versionLabel(v)} {v.current && <Tag color="success">{l.versionCurrent}</Tag>}
                  </span>
                ),
                disabled: !template.usable && !versionIds.includes(v.id),
              }))}
          />
        </Field>
      )}
      </>}
      {fields.entry?.status === "loading" && <Spin size="small" tip={l.loadingFields}><div className="sf-rd-spin" /></Spin>}
      {fields.entry?.status === "error" && (
        <Alert
          type="error"
          showIcon
          message={l.fieldsFailed}
          action={
            <Button size="small" onClick={fields.retry}>
              {l.retry}
            </Button>
          }
        />
      )}
      {catalog && (
        <>
          {!sql && <Field ctx={ctx} label={l.grain} htmlFor={ctx.id("grain")} paths={["data.grain", "data.table_key"]}>
            <Select<string>
              id={ctx.id("grain")}
              aria-label={l.grain}
              value={grainValue}
              disabled={ctx.readOnly}
              virtual={false}
              options={catalog.grains.map((g) => {
                const name = g.grain === "document" ? l.grainDocument : l.grainTable(localName({ name: g.name, names: g.names, path: g.table_key ?? "" }, ctx.lang));
                return {
                  value: g.grain === "document" ? "document" : `table:${g.table_key}`,
                  label: g.compatible ? name : `${name} (${l.grainIncompatible})`,
                  disabled: !g.compatible,
                };
              })}
              onChange={(v) => onCard(v === "document" ? setGrain(card, "document", null, all) : setGrain(card, "table", v.slice(6), all))}
              style={{ width: "100%" }}
            />
          </Field>}

          {card.type === "table" ? <RawFields card={card} fields={all} onCard={onCard} typeLabel={(t) => ctx.labels.fieldTypes[t] ?? t} lang={ctx.lang} readOnly={ctx.readOnly} /> : <fieldset className="sf-rd-group">
            <legend>{l.measure}</legend>
            <Field ctx={ctx} label={l.agg} htmlFor={ctx.id("agg")} paths={["data.measure.agg", "data.measure"]}>
              <Select<Agg>
                id={ctx.id("agg")}
                aria-label={l.agg}
                value={agg}
                disabled={ctx.readOnly}
                virtual={false}
                options={AGGS.map((a) => ({ value: a, label: l.aggs[a] }))}
                onChange={(a) => {
                  // a count is a whole number: default its decimals to 0, and back to 2 when it
                  // stops being a count with those decimals untouched (FR-REPORT-013)
                  const p = card.style?.precision ?? 2;
                  const precision = a === "count" ? 0 : agg === "count" && p === 0 ? 2 : p;
                  onCard({
                    ...card,
                    style: { ...card.style, precision },
                    data: pruneConfirmed({
                      ...data,
                      measure: { agg: a, path: a === "count" ? null : (data.measure?.path ?? null) },
                    }, pagePaths),
                  });
                }}
                style={{ width: "100%" }}
              />
            </Field>
            {agg !== "count" && (
              <Field
                ctx={ctx}
                label={l.measureField}
                htmlFor={ctx.id("measure")}
                paths={["data.measure.path"]}
                warn={missing(data.measure?.path, measureOpts, ctx)}
              >
                <FieldSelect
                  ctx={ctx}
                  id={ctx.id("measure")}
                  label={l.measureField}
                  value={data.measure?.path}
                  options={measureOpts}
                  onChange={(p) => set({ measure: { agg, path: p } })}
                  status={ctx.at("data.measure.path").length ? "error" : undefined}
                />
              </Field>
            )}
          </fieldset>}

          {!isMetric && card.type !== "table" && (
            <fieldset className="sf-rd-group">
              <legend>{l.dimension}</legend>
              <Field ctx={ctx} label={l.dimension} htmlFor={ctx.id("dimkind")} paths={["data.dimension.kind", "data.dimension"]}>
                <Radio.Group
                  id={ctx.id("dimkind")}
                  aria-label={l.dimension}
                  disabled={ctx.readOnly}
                  value={kind}
                  optionType="button"
                  options={(["category", "date"] as const).map((k) => ({
                    value: k,
                    label: l.dimensionKinds[k],
                  }))}
                  onChange={(e) => {
                    const k = e.target.value as "date" | "category" | "none";
                    set({
                      dimension: k === "date" ? { kind: k, path: null, time_grain: "month" } : k === "category" ? { kind: k, path: null } : { kind: "none" },
                      series: data.series,
                    });
                  }}
                />
              </Field>
              {kind !== "none" && (
                <Field
                  ctx={ctx}
                  label={l.dimensionField}
                  htmlFor={ctx.id("dim")}
                  paths={["data.dimension.path"]}
                  warn={missing(data.dimension?.path, dimOpts, ctx)}
                >
                  <FieldSelect
                    ctx={ctx}
                    id={ctx.id("dim")}
                    label={l.dimensionField}
                    value={data.dimension?.path}
                    options={dimOpts}
                    onChange={(p) => set({ dimension: { ...data.dimension, kind, path: p } })}
                    status={ctx.at("data.dimension.path").length ? "error" : undefined}
                  />
                </Field>
              )}
              {kind === "date" && (
                <Field ctx={ctx} label={l.timeGrain} htmlFor={ctx.id("grainT")} paths={["data.dimension.time_grain"]}>
                  <Radio.Group
                    id={ctx.id("grainT")}
                    aria-label={l.timeGrain}
                    disabled={ctx.readOnly}
                    optionType="button"
                    value={data.dimension?.time_grain ?? undefined}
                    options={TIME_GRAINS.map((g) => ({ value: g, label: l.timeGrains[g] }))}
                    onChange={(e) => set({ dimension: { ...data.dimension, kind, time_grain: e.target.value as TimeGrain } })}
                  />
                </Field>
              )}
              {!noSeries && (
                <Field ctx={ctx} label={l.series} htmlFor={ctx.id("series")} paths={["data.series.path", "data.series"]} warn={missing(data.series?.path, seriesOpts, ctx)}>
                  <FieldSelect
                    ctx={ctx}
                    id={ctx.id("series")}
                    label={l.series}
                    value={data.series?.path}
                    options={seriesOpts}
                    allowClear
                    onChange={(p) => set({ series: p ? { path: p } : null })}
                  />
                </Field>
              )}
            </fieldset>
          )}

          <Field
            ctx={ctx}
            label={l.dateField}
            htmlFor={ctx.id("date")}
            paths={["data.date_field.path", "data.date_field"]}
            help={l.dateFieldHelp}
            warn={missing(data.date_field?.path, dateOpts, ctx)}
          >
            <FieldSelect
              ctx={ctx}
              id={ctx.id("date")}
              label={l.dateField}
              value={data.date_field?.path}
              options={dateOpts}
              allowClear
              onChange={(p) => set({ date_field: p ? { path: p } : null })}
            />
          </Field>

          {card.type !== "table" && agg !== "count" && (
            <fieldset className="sf-rd-group">
              <legend>{l.unit}</legend>
              <Field ctx={ctx} label={l.unit} htmlFor={ctx.id("unitmode")} paths={["data.unit.mode", "data.unit"]}>
                <Radio.Group
                  id={ctx.id("unitmode")}
                  aria-label={l.unit}
                  disabled={ctx.readOnly}
                  optionType="button"
                  value={data.unit?.mode ?? undefined}
                  options={(["fixed", "field"] as const).map((m) => ({ value: m, label: l.unitModes[m] }))}
                  onChange={(e) =>
                    set({ unit: e.target.value === "fixed" ? { mode: "fixed", value: data.unit?.value ?? "" } : { mode: "field", path: null } })
                  }
                />
              </Field>
              {data.unit?.mode === "fixed" && (
                <Field ctx={ctx} label={l.unitValue} htmlFor={ctx.id("unitval")} paths={["data.unit.value"]}>
                  <Input
                    id={ctx.id("unitval")}
                    value={data.unit.value ?? ""}
                    maxLength={REPORT_LIMITS.unit}
                    disabled={ctx.readOnly}
                    placeholder="THB"
                    status={ctx.at("data.unit.value").length ? "error" : undefined}
                    onChange={(e) => set({ unit: { ...data.unit, mode: "fixed", value: e.target.value } })}
                  />
                </Field>
              )}
              <Field
                ctx={ctx}
                label={data.unit?.mode === "field" ? l.unitField : l.unitCheckField}
                htmlFor={ctx.id("unitpath")}
                paths={["data.unit.path"]}
                warn={missing(data.unit?.path, unitOpts, ctx)}
              >
                <FieldSelect
                  ctx={ctx}
                  id={ctx.id("unitpath")}
                  label={data.unit?.mode === "field" ? l.unitField : l.unitCheckField}
                  value={data.unit?.path}
                  options={unitOpts}
                  allowClear={data.unit?.mode !== "field"}
                  onChange={(p) => set({ unit: { ...data.unit, mode: data.unit?.mode ?? "fixed", path: p } })}
                  status={ctx.at("data.unit.path").length ? "error" : undefined}
                />
              </Field>
            </fieldset>
          )}

          {versionIds.length > 1 && used.length > 0 && (
            <fieldset className="sf-rd-group">
              <legend>{l.confirm}</legend>
              <Field ctx={ctx} label={null} paths={["data.confirmed_paths"]} help={l.confirmHelp}>
                <div className="sf-rd-confirm">
                  {used.map((p) => (
                    <Checkbox
                      key={p}
                      disabled={ctx.readOnly}
                      checked={(data.confirmed_paths ?? []).includes(p)}
                      onChange={(e) => {
                        const rest = (data.confirmed_paths ?? []).filter((x) => x !== p);
                        set({ confirmed_paths: e.target.checked ? [...rest, p] : rest });
                      }}
                    >
                      {nameOf(p)}
                    </Checkbox>
                  ))}
                </div>
              </Field>
            </fieldset>
          )}
        </>
      )}
    </div>
  );
}

function ColorList({ ctx, colors, onChange }: { ctx: Ctx; colors: string[]; onChange: (next: string[]) => void }) {
  const l = ctx.labels;
  return (
    <div className="sf-rd-colors">
      {colors.map((c, i) => (
        <span key={i} className="sf-rd-color">
          <input
            type="color"
            aria-label={`${l.colors} ${i + 1}`}
            value={/^#[0-9a-fA-F]{6}$/.test(c) ? c : "#000000"}
            disabled={ctx.readOnly}
            onChange={(e) => onChange(colors.map((x, j) => (j === i ? e.target.value.toUpperCase() : x)))}
          />
          <Button size="small" type="text" aria-label={l.removeColor(i + 1)} disabled={ctx.readOnly} onClick={() => onChange(colors.filter((_, j) => j !== i))}>
            ×
          </Button>
        </span>
      ))}
      {colors.length < REPORT_LIMITS.colors && (
        <Button size="small" disabled={ctx.readOnly} onClick={() => onChange([...colors, "#1A6FE8"])}>
          {l.addColor}
        </Button>
      )}
    </div>
  );
}

function StyleTab({ card, ctx, onCard }: { card: ReportCard; ctx: Ctx; onCard: (next: ReportCard) => void }) {
  const l = ctx.labels;
  const style: ReportCardStyle = card.style ?? {};
  const set = (patch: Partial<ReportCardStyle>) => onCard({ ...card, style: { ...style, ...patch } });
  const axis = style.axis ?? {};
  const setAxis = (patch: NonNullable<ReportCardStyle["axis"]>) => set({ axis: { ...axis, ...patch } });
  const canvas = card.type === "bar" || card.type === "line" || card.type === "pie" || card.type === "donut";
  const axes = card.type === "bar" || card.type === "line";
  const sw = (key: "legend" | "labels" | "stacked", label: string, dflt: boolean) => (
    <Field ctx={ctx} label={label} htmlFor={ctx.id(`sw-${key}`)} paths={[`style.${key}`]}>
      <Switch id={ctx.id(`sw-${key}`)} disabled={ctx.readOnly} checked={style[key] ?? dflt} onChange={(v) => set({ [key]: v })} />
    </Field>
  );
  return (
    <div className="sf-rd-tab">
      <Field ctx={ctx} label={l.precision} htmlFor={ctx.id("precision")} paths={["style.precision"]}>
        <InputNumber
          id={ctx.id("precision")}
          min={REPORT_LIMITS.precision.min}
          max={REPORT_LIMITS.precision.max}
          precision={0}
          disabled={ctx.readOnly}
          value={style.precision ?? 2}
          onChange={(v) => set({ precision: typeof v === "number" ? v : 2 })}
        />
      </Field>
      {canvas && (
        <>
          <Field ctx={ctx} label={l.colors} paths={["style.colors"]} help={l.colorsHelp}>
            <ColorList ctx={ctx} colors={style.colors ?? []} onChange={(colors) => set({ colors })} />
          </Field>
          <div className="sf-rd-switches">
            {sw("legend", l.legend, true)}
            {sw("labels", l.dataLabels, false)}
            {axes && sw("stacked", l.stacked, false)}
          </div>
        </>
      )}
      {axes && (
        <fieldset className="sf-rd-group">
          <legend>{l.axis}</legend>
          <div className="sf-rd-switches">
            <Field ctx={ctx} label={l.showX} htmlFor={ctx.id("showx")} paths={["style.axis.show_x"]}>
              <Switch id={ctx.id("showx")} disabled={ctx.readOnly} checked={axis.show_x ?? true} onChange={(v) => setAxis({ show_x: v })} />
            </Field>
            <Field ctx={ctx} label={l.showY} htmlFor={ctx.id("showy")} paths={["style.axis.show_y"]}>
              <Switch id={ctx.id("showy")} disabled={ctx.readOnly} checked={axis.show_y ?? true} onChange={(v) => setAxis({ show_y: v })} />
            </Field>
          </div>
          <Field ctx={ctx} label={l.xTitle} htmlFor={ctx.id("xtitle")} paths={["style.axis.x_title"]}>
            <Input id={ctx.id("xtitle")} maxLength={REPORT_LIMITS.title} disabled={ctx.readOnly} value={axis.x_title ?? ""} onChange={(e) => setAxis({ x_title: e.target.value || null })} />
          </Field>
          <Field ctx={ctx} label={l.yTitle} htmlFor={ctx.id("ytitle")} paths={["style.axis.y_title"]}>
            <Input id={ctx.id("ytitle")} maxLength={REPORT_LIMITS.title} disabled={ctx.readOnly} value={axis.y_title ?? ""} onChange={(e) => setAxis({ y_title: e.target.value || null })} />
          </Field>
        </fieldset>
      )}
    </div>
  );
}

function CardPanel({
  card,
  ctx,
  templates,
  sources,
  querySource,
  loadTables,
  cache,
  loadFields,
  unplaced,
  onCard,
  onRemove,
  onUpload,
  embedOrigins,
  pagePaths,
}: {
  card: ReportCard;
  ctx: Ctx;
  templates: readonly DesignerTemplate[];
  sources: readonly DesignerSource[];
  querySource?: SourceQuery;
  loadTables?: SourceTables;
  cache: Map<string, FieldsEntry>;
  loadFields: ReportDesignerProps["loadFields"];
  unplaced: string[];
  onCard: (next: ReportCard) => void;
  onRemove: () => void;
  onUpload?: ReportDesignerProps["onUpload"];
  embedOrigins?: readonly string[];
  pagePaths: string[];
}) {
  const l = ctx.labels;
  const fields = useCardFields(cache, loadFields, card.data);
  const [tab, setTab] = useState("data");
  return (
    <section className="sf-rd-panel__body" aria-label={l.cardPanel}>
      <div className="sf-rd-panel__head">
        <h3 className="sf-rd-panel__title">{l.cardPanel}</h3>
        {!ctx.readOnly && (
          <Popconfirm title={l.removeConfirm} okText={l.confirmOk} cancelText={l.cancel} okButtonProps={{ danger: true }} onConfirm={onRemove}>
            <Button size="small" danger>
              {l.removeCard}
            </Button>
          </Popconfirm>
        )}
      </div>
      {unplaced.length > 0 && <Alert type="error" showIcon message={unplaced.join(" · ")} />}
      <Field ctx={ctx} label={l.cardType} htmlFor={ctx.id("type")} paths={["type"]}>
        <Select<ChartType>
          id={ctx.id("type")}
          aria-label={l.cardType}
          value={card.type}
          disabled={ctx.readOnly}
          virtual={false}
          options={CHART_TYPES.map((t) => ({ value: t, label: l.chartTypes[t] }))}
          onChange={(t) => onCard(changeType(card, t))}
          style={{ width: "100%" }}
        />
      </Field>
      <Field ctx={ctx} label={l.cardTitle} htmlFor={ctx.id("title")} paths={["title"]}>
        <Input
          id={ctx.id("title")}
          value={card.title ?? ""}
          maxLength={REPORT_LIMITS.title}
          disabled={ctx.readOnly}
          placeholder={l.untitled(l.chartTypes[card.type])}
          onChange={(e) => onCard({ ...card, title: e.target.value })}
        />
      </Field>
      <Tabs
        activeKey={tab}
        onChange={setTab}
        items={[
          { key: "data", label: card.type === "image" || card.type === "html" ? v2Labels(ctx.lang).content : l.tabData, children: card.type === "image" || card.type === "html" ? <ContentPanel card={card} onCard={onCard} onUpload={onUpload} embedOrigins={embedOrigins} lang={ctx.lang} readOnly={ctx.readOnly} /> : <DataTab card={card} ctx={ctx} templates={templates} sources={sources} querySource={querySource} loadTables={loadTables} fields={fields} pagePaths={pagePaths} onCard={onCard} /> },
          ...(card.type === "image" || card.type === "html" ? [] : [{ key: "filters", label: v2Labels(ctx.lang).filters, children: <FiltersEditor group={card.data?.filters} fields={filterFields(fields.entry?.status === "ok" ? fields.entry.data.fields : [], card)} lang={ctx.lang} readOnly={ctx.readOnly} onChange={(filters) => onCard({ ...card, data: { ...card.data, filters } })} /> }]),
          { key: "style", label: l.tabStyle, children: <><CardAppearance card={card} onCard={onCard} lang={ctx.lang} readOnly={ctx.readOnly} />{card.type !== "image" && card.type !== "html" && <StyleTab card={card} ctx={ctx} onCard={onCard} />}</> },
        ]}
      />
    </section>
  );
}

function PagePanel({ value, ctx, onChange, loadFields }: { value: ReportConfig; ctx: Ctx; onChange: (next: ReportConfig) => void; loadFields: ReportDesignerProps["loadFields"] }) {
  const l = ctx.labels;
  const period = value.period ?? { mode: "current_year" as const };
  const grid = value.grid ?? {};
  return (
    <section className="sf-rd-panel__body" aria-label={l.pagePanel}>
      <h3 className="sf-rd-panel__title">{l.pagePanel}</h3>
      <PageAppearance value={value} onChange={onChange} lang={ctx.lang} readOnly={ctx.readOnly} />
      <PageFilters value={value} onChange={onChange} loadFields={loadFields} lang={ctx.lang} readOnly={ctx.readOnly} />
      <Field ctx={ctx} label={l.period} htmlFor={ctx.id("pmode")} paths={["period", "period.mode"]} help={l.periodHelp}>
        <Radio.Group
          id={ctx.id("pmode")}
          aria-label={l.period}
          disabled={ctx.readOnly}
          value={period.mode}
          options={(["current_year", "fixed"] as const).map((m) => ({ value: m, label: l.periodModes[m] }))}
          onChange={(e) =>
            onChange({
              ...value,
              period: e.target.value === "fixed" ? { mode: "fixed", from: period.from ?? null, to: period.to ?? null } : { mode: "current_year", from: null, to: null },
            })
          }
        />
      </Field>
      {period.mode === "fixed" && (
        <div className="sf-rd-dates">
          <Field ctx={ctx} label={l.periodFrom} htmlFor={ctx.id("pfrom")} paths={["period.from"]}>
            <Input
              id={ctx.id("pfrom")}
              type="date"
              disabled={ctx.readOnly}
              value={period.from ?? ""}
              onChange={(e) => onChange({ ...value, period: { ...period, mode: "fixed", from: e.target.value || null } })}
            />
          </Field>
          <Field ctx={ctx} label={l.periodTo} htmlFor={ctx.id("pto")} paths={["period.to"]}>
            <Input
              id={ctx.id("pto")}
              type="date"
              disabled={ctx.readOnly}
              value={period.to ?? ""}
              onChange={(e) => onChange({ ...value, period: { ...period, mode: "fixed", to: e.target.value || null } })}
            />
          </Field>
        </div>
      )}
      <Field ctx={ctx} label={l.rowHeight} htmlFor={ctx.id("rowh")} paths={["grid.row_height", "grid"]}>
        <InputNumber
          id={ctx.id("rowh")}
          min={REPORT_LIMITS.rowHeight.min}
          max={REPORT_LIMITS.rowHeight.max}
          precision={0}
          disabled={ctx.readOnly}
          value={grid.row_height ?? 80}
          onChange={(v) => onChange({ ...value, grid: { ...grid, cols: 12, row_height: typeof v === "number" ? v : 80 } })}
        />
      </Field>
    </section>
  );
}

/**
 * The PC / admin report designer (FR-REPORT-005, 006, 013, 014): a chart palette, the 12-column
 * grid (drag, resize, keyboard) and a data / style panel. Controlled and pure: the app loads the
 * catalog and previews, saves, publishes and explains refusals.
 */
export function ReportDesigner({
  value,
  onChange,
  templates,
  sources = [],
  querySource,
  loadTables,
  onPreviewPage,
  loadFields,
  preview,
  previewLoading,
  previewStale,
  errors = [],
  errorsStale,
  readOnly = false,
  lang,
  locale,
  labels: labelsIn,
  chartLabels,
  gridLabels,
  onUpload,
  loadAsset,
  embedOrigins,
}: ReportDesignerProps) {
  const labels = useMemo(() => mergeReportDesignerLabels(labelsIn), [labelsIn]);
  const baseId = useId();
  const [cache] = useState(() => new Map<string, FieldsEntry>());
  const [selected, setSelected] = useState<string | null>(null);
  const cards = value.cards;
  const card = cards.find((c) => c.id === selected) ?? null;
  const full = cards.length >= REPORT_LIMITS.cards;
  const emit = (next: ReportConfig) => {
    if (!readOnly) onChange?.(next);
  };

  const grouped = useMemo(() => groupProblems(errors, cards), [errors, cards]);
  const loc = (m: string) => localizeReportError(m, labels.errors);
  const cardProblems = card ? (grouped.byCard.get(card.id) ?? []) : [];
  const ctx: Ctx = {
    labels,
    readOnly,
    lang,
    id: (name) => `${baseId}-${name}`,
    at: (...paths) => {
      const source = card
        ? cardProblems
        : grouped.page.map((p) => ({ rel: p.path, problem: p }));
      return source
        .filter(({ rel }) => paths.some((p) => rel === p || rel.startsWith(`${p}[`) || rel.startsWith(`${p}.`)))
        .map(({ problem }) => loc(problem.message));
    },
  };
  // problems the panel has no input for (e.g. layout overlap) are listed at its top
  const PANEL_PATHS = /^(type|title|data\.|style\.)/;
  const unplaced = cardProblems.filter(({ rel }) => !PANEL_PATHS.test(rel)).map(({ problem }) => loc(problem.message));

  const results = useMemo(() => new Map((preview?.cards ?? []).map((r) => [r.card_id, r])), [preview]);
  const total = errors.length;
  const typeName = (c: ReportCard) => labels.chartTypes[c.type] ?? c.type;
  const titleOf = (c: ReportCard) => c.title?.trim() || labels.untitled(typeName(c));

  const renderCard = (c: ReportCard) => {
    const result = results.get(c.id);
    const n = grouped.byCard.get(c.id)?.length ?? 0;
    const badge = n > 0 && <Tag color="error" className="sf-rd-card__badge">{n}</Tag>;
    if (!result && !previewLoading && c.type !== "image" && c.type !== "html") {
      return (
        <div className="sf-rd-card">
          <div className="sf-rd-card__head">
            <span className="sf-rd-card__title" title={titleOf(c)}>
              {titleOf(c)}
            </span>
            {badge}
          </div>
          <div className="sf-rd-card__placeholder">
            <span className="sf-rd-card__glyph"><ChartTypeIcon type={c.type} /></span>
            <span>{typeName(c)}</span>
            <small>{labels.previewHint}</small>
          </div>
        </div>
      );
    }
    return (
      <div className="sf-rd-card">
        {badge && <div className="sf-rd-card__corner">{badge}</div>}
        <ChartRenderer card={{ ...c, title: titleOf(c) }} result={result} onPageChange={onPreviewPage && !previewLoading && !previewStale ? (page) => onPreviewPage(c.id, page) : undefined} loading={previewLoading} labels={chartLabels} locale={locale} headingLevel={4} loadAsset={loadAsset} embedOrigins={embedOrigins} interactive={false} palette={REPORT_PALETTES[value.appearance?.theme ?? "brand"]} />
      </div>
    );
  };

  return (
    <div className={`sf-rd${readOnly ? " is-readonly" : ""}`}>
      {total > 0 && (
        <Alert
          type="error"
          showIcon
          role="alert"
          message={labels.errorSummary(total)}
          description={
            <div className="sf-rd-summary">
              {errorsStale && <p className="sf-rd-summary__note">{labels.errorsStale}</p>}
              <ul>
                {grouped.page.map((p, i) => (
                  <li key={`p${i}`}>{loc(p.message)}</li>
                ))}
                {cards
                  .filter((c) => grouped.byCard.has(c.id))
                  .map((c) => (
                    <li key={c.id}>
                      <Button type="link" size="small" className="sf-rd-summary__link" onClick={() => setSelected(c.id)}>
                        {labels.cardProblems(titleOf(c), grouped.byCard.get(c.id)?.length ?? 0)}
                      </Button>
                    </li>
                  ))}
              </ul>
            </div>
          }
        />
      )}
      {preview?.synthetic && <Alert type="warning" showIcon message={labels.previewSynthetic} className="sf-rd-synthetic" />}
      {previewStale && preview && <Alert type="info" showIcon message={labels.previewStale} />}
      <div className="sf-rd__body">
        {!readOnly && (
          <nav className="sf-rd__palette" aria-label={labels.palette}>
            <h3 className="sf-rd-panel__title">{labels.palette}</h3>
            <div className="sf-rd__palette-list">
              {CHART_TYPES.map((t) => (
                <Button
                  key={t}
                  block
                  className={`sf-rd-palette-tile sf-rd-palette-tile--${t}`}
                  icon={<ChartTypeIcon type={t} />}
                  disabled={full}
                  aria-label={labels.add(labels.chartTypes[t])}
                  onClick={() => {
                    const out = addCard(value, t);
                    emit(out.config);
                    setSelected(out.id);
                  }}
                >
                  {labels.chartTypes[t]}
                </Button>
              ))}
            </div>
            {full && <p className="sf-rd__limit">{labels.cardLimit(REPORT_LIMITS.cards)}</p>}
          </nav>
        )}
        <div className="sf-rd__canvas" aria-label={labels.canvas} role="region">
          {cards.length === 0 ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={labels.emptyCanvas} />
          ) : (
            <ReportGrid
              cards={cards}
              mode={readOnly ? "view" : "design"}
              rowHeight={value.grid?.row_height ?? 80}
              appearance={value.appearance}
              selectedId={selected}
              onSelect={(id) => setSelected((s) => (s === id && readOnly ? null : id))}
              onLayoutChange={(layouts) => emit(applyLayouts(value, layouts))}
              renderCard={renderCard}
              labels={{ card: (c) => titleOf(c as ReportCard), ...gridLabels }}
              fallback={<Spin />}
            />
          )}
        </div>
        <aside className="sf-rd__panel">
          {card && (
            <Button size="small" type="link" className="sf-rd__back" onClick={() => setSelected(null)}>
              ← {labels.pagePanel}
            </Button>
          )}
          <Form layout="vertical" component="div" disabled={readOnly}>
            {card ? (
              <CardPanel
                key={card.id}
                card={card}
                ctx={ctx}
                templates={templates}
                sources={sources}
                querySource={querySource}
                loadTables={loadTables}
                cache={cache}
                loadFields={loadFields}
                unplaced={unplaced}
                onUpload={onUpload}
                embedOrigins={embedOrigins}
                pagePaths={Object.values(value.filters?.targets[card.id] ?? {}).filter(Boolean)}
                onCard={(next) => emit(updateCard(value, card.id, () => next))}
                onRemove={() => {
                  emit(removeCard(value, card.id));
                  setSelected(null);
                }}
              />
            ) : (
              <PagePanel value={value} ctx={ctx} onChange={emit} loadFields={loadFields} />
            )}
          </Form>
        </aside>
      </div>
    </div>
  );
}
