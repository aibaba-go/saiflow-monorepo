import type { EChartsCoreOption } from "echarts/core";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import { isNegativeDecimal } from "../decimal";
import type { CardResult, ReportCard } from "../reportTypes";
import { loadEcharts, type EchartsApi } from "./echartsLoader";
import { mergeChartLabels, type ChartLabels } from "./labels";
import { buildChartModel, type ChartModel } from "./model";
import { buildEchartsOption, chartColors } from "./option";
import "../components.css";

export interface ChartRendererProps {
  /** One card of the report config (type, title, data, style). */
  card: ReportCard;
  /** This card's entry of QueryResult.cards; undefined/null while not loaded. */
  result?: CardResult | null;
  /** Show the loading state (e.g. while refreshing). */
  loading?: boolean;
  /** Translated texts; English defaults. The card title is user text and is never translated. */
  labels?: Partial<ChartLabels>;
  /** BCP 47 locale for axis tick numbers (exact values use fixed "," / "." formatting). */
  locale?: string;
  /** Series colours when the card has no style.colors; defaults to the STD-008 palette. */
  palette?: readonly string[];
  /** Render the card title as a heading; default true. */
  showTitle?: boolean;
  headingLevel?: 2 | 3 | 4 | 5 | 6;
  /** Shows a retry button in the error state. */
  onRetry?: () => void;
  /** Extra content under the chart (e.g. diagnostics or "stale data" notice from the app). */
  footer?: ReactNode;
  className?: string;
  loadAsset?: (id: string, signal: AbortSignal) => Promise<Blob>;
  embedOrigins?: readonly string[];
}

function DataTable({ model, labels, caption, hidden }: { model: ChartModel; labels: ChartLabels; caption: string; hidden?: boolean }) {
  const hasUnit = model.units.length > 0;
  const table = (
    <table className="sf-chart__table">
      <caption className={hidden ? undefined : "sf-visually-hidden"}>{caption}</caption>
      <thead>
        <tr>
          {model.hasDimension && <th scope="col">{labels.category}</th>}
          {model.hasSeries && <th scope="col">{labels.series}</th>}
          <th scope="col" className="sf-num">
            {labels.value}
          </th>
          {hasUnit && <th scope="col">{labels.unit}</th>}
          <th scope="col" className="sf-num">
            {labels.count}
          </th>
        </tr>
      </thead>
      <tbody>
        {model.rows.map((r, i) => (
          <tr key={i}>
            {model.hasDimension && <th scope="row">{r.dimension}</th>}
            {model.hasSeries && <td>{r.series}</td>}
            <td className="sf-num" title={r.exact ?? undefined}>
              {r.display}
            </td>
            {hasUnit && <td>{r.unit ?? ""}</td>}
            <td className="sf-num">{r.count}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
  if (hidden) return <div className="sf-visually-hidden">{table}</div>;
  return (
    // A scrollable region must be reachable by keyboard (narrow LINE screens).
    <div className="sf-chart__table-wrap" role="region" aria-label={caption} tabIndex={0}>
      {table}
    </div>
  );
}

function EChartCanvas({ option, label, failedText }: { option: EChartsCoreOption; label: string; failedText: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const [failed, setFailed] = useState(false);

  // Resize with the container; dispose on unmount.
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let api: EchartsApi | null = null;
    loadEcharts().then(
      (ec) => {
        api = ec;
      },
      () => undefined,
    );
    const observer =
      typeof ResizeObserver === "undefined"
        ? null
        : new ResizeObserver(() => {
            api?.getInstanceByDom(el)?.resize();
          });
    observer?.observe(el);
    return () => {
      observer?.disconnect();
      loadEcharts().then(
        (ec) => ec.getInstanceByDom(el)?.dispose(),
        () => undefined,
      );
    };
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    let cancelled = false;
    loadEcharts().then(
      (ec) => {
        if (cancelled) return;
        const chart = ec.getInstanceByDom(el) ?? ec.init(el, undefined, { renderer: "canvas" });
        chart.setOption(option, { notMerge: true });
      },
      () => {
        if (!cancelled) setFailed(true);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [option]);

  return (
    <div className="sf-chart__canvas-wrap">
      <div ref={ref} className="sf-chart__canvas" role="img" aria-label={label} data-testid="sf-chart-canvas" />
      {failed && <p className="sf-chart__note">{failedText}</p>}
    </div>
  );
}

function StaticImage({ card, loadAsset, labels }: { card: ReportCard; loadAsset?: ChartRendererProps["loadAsset"]; labels: ChartLabels }) {
  const [loaded, setLoaded] = useState<{ id: string; loader: ChartRendererProps["loadAsset"]; attempt: number; url: string | null; failed: boolean } | null>(null);
  const [attempt, setAttempt] = useState(0);
  const id = card.content?.asset_id;
  const current = loaded?.id === id && loaded?.loader === loadAsset && loaded?.attempt === attempt ? loaded : null;
  const url = current?.url;
  const failed = !id || !loadAsset || current?.failed;
  useEffect(() => {
    if (!id || !loadAsset) return;
    const controller = new AbortController();
    let objectUrl: string | null = null;
    loadAsset(id, controller.signal).then((blob) => {
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setLoaded({ id, loader: loadAsset, attempt, url: objectUrl, failed: false });
    }).catch(() => { if (!controller.signal.aborted) setLoaded({ id, loader: loadAsset, attempt, url: null, failed: true }); });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [id, loadAsset, attempt]);
  if (failed) return <StateBox kind="error">{labels.error}<button type="button" className="sf-btn" onClick={() => setAttempt(attempt + 1)}>{labels.retry}</button></StateBox>;
  return url ? <img src={url} alt={card.content?.alt ?? ""} style={{ width: "100%", height: "100%", objectFit: card.content?.fit ?? "contain" }} /> : <StateBox kind="loading">{labels.loading}</StateBox>;
}

function safeHtml(html: string): string {
  const doc = new DOMParser().parseFromString(html, "text/html");
  const tags = new Set("DIV SPAN P H1 H2 H3 H4 H5 H6 BR HR STRONG B EM I U SMALL UL OL LI TABLE THEAD TBODY TR TD TH BLOCKQUOTE PRE CODE".split(" "));
  const styles = new Set("color background-color font-size font-weight text-align padding margin border border-radius line-height width max-width height".split(" "));
  const clean = (parent: Element) => {
    for (const el of [...parent.children]) {
      if (!tags.has(el.tagName)) { el.remove(); continue; }
      const declarations = (el.getAttribute("style") ?? "").split(";").filter((d) => {
        const [name, value] = d.split(":");
        return styles.has(name?.trim().toLowerCase() ?? "") && /^[a-zA-Z0-9#.%\s-]{1,100}$/.test(value?.trim() ?? "");
      });
      for (const attr of [...el.attributes]) el.removeAttribute(attr.name);
      if (declarations.length) el.setAttribute("style", declarations.join(";"));
      clean(el);
    }
  };
  clean(doc.body);
  return `<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'"><style>body{font-family:system-ui;margin:16px;color:#243858}table{border-collapse:collapse;width:100%}td,th{padding:8px;border:1px solid #ddd}</style>${doc.body.innerHTML}`;
}

function StateBox({ kind, children }: { kind: "loading" | "empty" | "error" | "info"; children: ReactNode }) {
  return (
    <div className={`sf-chart__state sf-chart__state--${kind}`} role="status">
      {children}
    </div>
  );
}

/**
 * Renders one published/preview card: bar, line, pie, donut, metric or table (FR-REPORT-005,
 * 012, 013, 018). Pure: config + result + labels in, no data fetching.
 */
export function ChartRenderer({
  card,
  result,
  loading,
  labels: labelsIn,
  locale,
  palette,
  showTitle = true,
  headingLevel = 3,
  onRetry,
  footer,
  className,
  loadAsset,
  embedOrigins = [],
}: ChartRendererProps) {
  const labels = useMemo(() => mergeChartLabels(labelsIn), [labelsIn]);
  const title = card.title?.trim() ?? "";
  const model = useMemo(() => (result ? buildChartModel(card, result, labels) : null), [card, result, labels]);
  const isPie = card.type === "pie" || card.type === "donut";
  const negativeInPie =
    isPie && !!result && result.status !== "error" && result.rows.some((r) => r.value !== null && isNegativeDecimal(r.value));
  const usesCanvas = card.type === "bar" || card.type === "line" || isPie;
  const colors = useMemo(() => chartColors(card, palette), [card, palette]);
  const option = useMemo(
    () => (model && usesCanvas ? buildEchartsOption(card, model, { colors, locale, noValue: labels.noValue }) : null),
    [card, model, usesCanvas, colors, locale, labels.noValue],
  );

  let body: ReactNode;
  const isStatic = card.type === "image" || card.type === "html";
  if (card.type === "image") {
    body = <StaticImage card={card} loadAsset={loadAsset} labels={labels} />;
  } else if (card.type === "html") {
    const content = card.content;
    const external = content?.mode === "url";
    const url = content?.url ?? "";
    let allowed = false;
    if (external) {
      try {
        const parsed = new URL(url);
        allowed = parsed.protocol === "https:" && !parsed.username && !parsed.password && !parsed.search && !parsed.hash && embedOrigins.includes(parsed.origin) && parsed.origin !== window.location.origin;
      } catch { allowed = false; }
    }
    body = external && !allowed ? <StateBox kind="error">{labels.error}</StateBox> : (
      <iframe title={title || labels.chartTypes.html} sandbox="" referrerPolicy="no-referrer" loading="lazy"
        src={external ? url : undefined} srcDoc={external ? undefined : safeHtml(content?.html ?? "")}
        style={{ width: "100%", height: "100%", border: 0 }} />
    );
  } else if (loading || !result || !model) {
    body = <StateBox kind="loading">{labels.loading}</StateBox>;
  } else if (result.status === "error" || negativeInPie) {
    const code = negativeInPie ? "negative_in_pie" : (result.error_code ?? "");
    const detail = (code && labels.errors[code]) || null;
    body = (
      <StateBox kind="error">
        <span className="sf-chart__state-title">{labels.error}</span>
        {detail && <span>{detail}</span>}
        {onRetry && (
          <button type="button" className="sf-btn" onClick={onRetry}>
            {labels.retry}
          </button>
        )}
      </StateBox>
    );
  } else if (result.status === "empty" || model.rows.length === 0) {
    body = (
      <>
        {result.status === "not_applicable" && <p className="sf-chart__note">{labels.notApplicable}</p>}
        <StateBox kind="empty">{labels.empty}</StateBox>
      </>
    );
  } else {
    const summary = labels.summary({
      title,
      type: labels.chartTypes[card.type] ?? card.type,
      points: model.pointCount,
      series: model.series.length,
    });
    let content: ReactNode;
    if (card.type === "metric") {
      content = (
        <ul className="sf-metric" aria-label={summary}>
          {model.rows.map((r, i) => (
            <li key={i} className="sf-metric__item">
              <span className="sf-metric__value" title={r.exact ?? undefined}>
                {r.display}
              </span>
              {r.unit && <span className="sf-metric__unit">{r.unit}</span>}
              {r.series !== null && <span className="sf-metric__label">{r.series}</span>}
            </li>
          ))}
        </ul>
      );
    } else if (card.type === "table") {
      content = <DataTable model={model} labels={labels} caption={title || summary} />;
    } else if (option) {
      content = (
        <>
          <EChartCanvas option={option} label={summary} failedText={labels.error} />
          <DataTable model={model} labels={labels} caption={title || summary} hidden />
        </>
      );
    }
    body = (
      <>
        {result.status === "not_applicable" && <p className="sf-chart__note">{labels.notApplicable}</p>}
        {model.outOfRange && usesCanvas && <p className="sf-chart__note">{labels.outOfRange}</p>}
        {content}
      </>
    );
  }

  return (
    <section
      className={`sf-chart sf-chart--${card.type}${className ? ` ${className}` : ""}`}
      aria-busy={!isStatic && (loading || !result) ? true : undefined}
      style={card.style?.surface === "tinted" ? { background: `${colors[0]}12` } : undefined}
      data-card-id={card.id}
    >
      {showTitle && title && (
        <div className="sf-chart__title" role="heading" aria-level={headingLevel} title={title}>
          {title}
        </div>
      )}
      <div className="sf-chart__body">{body}</div>
      {footer}
    </section>
  );
}
