import type { ReactNode } from "react";

import type { CardExcluded, CardResult, ReportCard } from "../reportTypes";

import "../components.css";

/** A template a published card reads, with the explicit versions (ReportDetail.sources). */
export interface ReportCardSource {
  template_id: number;
  name: string;
  versions: { id: number; version: number }[];
}

export type ExcludedReason = keyof CardExcluded;

export const EXCLUDED_REASONS: readonly ExcludedReason[] = [
  "invalid_number",
  "too_precise",
  "invalid_date",
  "missing_date",
  "empty_row",
  "invalid_structure",
  "missing",
];

/** Texts of the card information (English defaults; apps pass translations). */
export interface ReportCardInfoLabels {
  source: string;
  /** "Template name · v1, v2". */
  sourceValue: (info: { name: string; versions: string }) => string;
  /** A template that is no longer readable here (deleted or no longer granted). */
  sourceUnknown: string;
  version: (n: number) => string;
  grain: string;
  grainDocument: string;
  grainTable: (table: string) => string;
  unit: string;
  unitFixed: (unit: string) => string;
  unitField: string;
  unitNone: string;
  counted: string;
  countedValue: (info: { documents: number; items: number | null }) => string;
  excluded: string;
  excludedNone: string;
  excludedTotal: (n: number) => string;
  reasons: Record<ExcludedReason, string>;
  details: string;
}

export const DEFAULT_REPORT_CARD_INFO_LABELS: ReportCardInfoLabels = {
  source: "Template",
  sourceValue: ({ name, versions }) => `${name} · ${versions}`,
  sourceUnknown: "Template not available",
  version: (n) => `v${n}`,
  grain: "Counted per",
  grainDocument: "Document",
  grainTable: (table) => `Row of table ${table}`,
  unit: "Unit",
  unitFixed: (unit) => unit,
  unitField: "From the unit field of each record",
  unitNone: "None",
  counted: "Counted",
  countedValue: ({ documents, items }) =>
    items === null ? `${documents} documents` : `${documents} documents, ${items} rows`,
  excluded: "Excluded",
  excludedNone: "None",
  excludedTotal: (n) => `${n} excluded`,
  reasons: {
    invalid_number: "Not a valid number",
    too_precise: "More than 2 decimal places",
    invalid_date: "Not a valid date",
    missing_date: "No date",
    empty_row: "Empty detail row",
    invalid_structure: "Unexpected data structure",
    missing: "No value",
  },
  details: "Details",
};

export interface CardDescription {
  source: string;
  grain: string;
  unit: string | null;
  counted: string | null;
  excluded: { reason: ExcludedReason; label: string; n: number }[];
  excludedTotal: number;
}

/** What a card counts (template + explicit versions, grain, unit) and how the last query went
 * (counted documents/rows, excluded values by reason) — FR-REPORT-002, FR-REPORT-011. */
export function describeCard(
  card: ReportCard,
  sources: readonly ReportCardSource[],
  result: CardResult | null | undefined,
  labels: ReportCardInfoLabels = DEFAULT_REPORT_CARD_INFO_LABELS,
): CardDescription {
  const data = card.data ?? {};
  const src = sources.find((s) => s.template_id === data.template_id);
  const wanted = new Set(data.template_version_ids ?? []);
  const versions = (src?.versions ?? [])
    .filter((v) => wanted.has(v.id))
    .sort((a, b) => a.version - b.version)
    .map((v) => labels.version(v.version))
    .join(", ");
  const source = src && versions ? labels.sourceValue({ name: src.name, versions }) : labels.sourceUnknown;
  const grain =
    data.grain === "table" ? labels.grainTable(data.table_key ?? "") : labels.grainDocument;
  const u = data.unit;
  const unit =
    u?.mode === "fixed" && u.value
      ? labels.unitFixed(u.value)
      : u?.mode === "field"
        ? labels.unitField
        : data.measure?.agg === "count"
          ? null
          : labels.unitNone;
  const diag = result && result.status !== "error" ? result.diagnostics : null;
  const counted = diag
    ? labels.countedValue({ documents: diag.documents, items: data.grain === "table" ? (diag.items ?? 0) : null })
    : null;
  const excluded = EXCLUDED_REASONS.map((reason) => ({
    reason,
    label: labels.reasons[reason],
    n: diag?.excluded?.[reason] ?? 0,
  })).filter((e) => e.n > 0);
  return { source, grain, unit, counted, excluded, excludedTotal: excluded.reduce((s, e) => s + e.n, 0) };
}

export interface ReportCardInfoProps {
  card: ReportCard;
  sources: readonly ReportCardSource[];
  result?: CardResult | null;
  labels?: Partial<ReportCardInfoLabels>;
  /** Buttons at the end (e.g. CSV, details); kept out of the text so they stay operable. */
  actions?: ReactNode;
  /** Show the full list (template, grain, unit, counts, every exclusion reason). */
  expanded?: boolean;
}

function merge(labels?: Partial<ReportCardInfoLabels>): ReportCardInfoLabels {
  return labels
    ? { ...DEFAULT_REPORT_CARD_INFO_LABELS, ...labels, reasons: { ...DEFAULT_REPORT_CARD_INFO_LABELS.reasons, ...labels.reasons } }
    : DEFAULT_REPORT_CARD_INFO_LABELS;
}

/** The full card information as a definition list (PC popover, LINE details). */
export function ReportCardDetails({ card, sources, result, labels: labelsIn }: Omit<ReportCardInfoProps, "actions" | "expanded">) {
  const labels = merge(labelsIn);
  const d = describeCard(card, sources, result, labels);
  return (
    <dl className="sf-card-info__list">
      <dt>{labels.source}</dt>
      <dd>{d.source}</dd>
      <dt>{labels.grain}</dt>
      <dd>{d.grain}</dd>
      {d.unit !== null && (
        <>
          <dt>{labels.unit}</dt>
          <dd>{d.unit}</dd>
        </>
      )}
      {d.counted !== null && (
        <>
          <dt>{labels.counted}</dt>
          <dd>{d.counted}</dd>
          <dt>{labels.excluded}</dt>
          <dd>
            {d.excluded.length === 0 ? (
              labels.excludedNone
            ) : (
              <ul className="sf-card-info__reasons">
                {d.excluded.map((e) => (
                  <li key={e.reason}>
                    {e.label}: <span className="sf-num">{e.n}</span>
                  </li>
                ))}
              </ul>
            )}
          </dd>
        </>
      )}
    </dl>
  );
}

/** A compact footer under a published card: what it counts and what the query left out. */
export function ReportCardInfo({ card, sources, result, labels: labelsIn, actions, expanded }: ReportCardInfoProps) {
  const labels = merge(labelsIn);
  const d = describeCard(card, sources, result, labels);
  const line = [d.source, d.grain, d.unit].filter(Boolean).join(" · ");
  const stats = [d.counted, d.excludedTotal > 0 ? labels.excludedTotal(d.excludedTotal) : null].filter(Boolean).join(" · ");
  return (
    <div className="sf-card-info">
      {expanded ? (
        <ReportCardDetails card={card} sources={sources} result={result} labels={labels} />
      ) : (
        <div className="sf-card-info__text">
          <p className="sf-card-info__line" title={line}>
            {line}
          </p>
          {stats && (
            <p className={`sf-card-info__line${d.excludedTotal > 0 ? " sf-card-info__line--warn" : ""}`} title={stats}>
              {stats}
            </p>
          )}
        </div>
      )}
      {actions && <div className="sf-card-info__actions">{actions}</div>}
    </div>
  );
}
