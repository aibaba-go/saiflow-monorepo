import {
  ChartRenderer,
  ReportCardDetails,
  ReportCardInfo,
  ReportGrid,
  type CardResult,
  type QueryResult,
  type ReportCard,
  REPORT_PALETTES,
} from "@saiflow/ui";
import { RotateCw } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { BrandLoading } from "../../components/BrandLoading";
import { Alert } from "../../components/ui/alert";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { BottomSheet } from "../../components/ui/sheet";
import { showToast } from "../../components/ui/toast";
import { useT } from "../../i18n";
import { ApiError, errorMessage } from "../../services/errors";
import { formatBangkokDateTime } from "../../utils/format";
import { authLiff } from "../auth/session";
import { PageHeader } from "../scan/components/PageHeader";
import theme from "../scan/theme.module.css";
import { useCurrentTenant } from "../tenants/useCurrentTenant";
import {
  configOf,
  copyText,
  downloadCsv,
  parseCsv,
  reportData,
  useReport,
  readReportAsset,
  useReportContentPolicy,
  type Period,
  type Published,
  type ReportDetail,
} from "./api";
import { useReportLabels } from "./labels";
import s from "./reports.module.css";

/** The last answer of the data endpoint, and whether a later attempt failed (FR-REPORT-015). */
interface DataState {
  result: QueryResult | null;
  error: unknown;
  loading: boolean;
}

/** A card body in the single column: the chart's own height from its PC rows (as the shared
 * default) plus room for the source line and the card actions below it. */
const FOOTER = 64;
const stackHeight = (card: ReportCard) => Math.min(420, Math.max(200, card.layout.h * 56)) + FOOTER;
/** Rows shown in the in-LINE CSV preview; the downloaded file and copied text have them all. */
const PREVIEW_ROWS = 50;

function Viewer({ detail, onStale }: { detail: ReportDetail & { published: Published }; onStale(): void }) {
  const t = useT();
  const navigate = useNavigate();
  const labels = useReportLabels();
  const config = useMemo(() => configOf(detail.published.config), [detail.published.config]);
  const contentPolicy = useReportContentPolicy(config.cards.some((card) => card.type === "html" && card.content?.mode === "url"));
  const loadAsset = useCallback((id: string, signal: AbortSignal) => readReportAsset(id, detail.id, signal), [detail.id, detail.tenant_id]);
  const version = detail.published.version;

  // the whole-page period: null = as published (FR-REPORT-010)
  const [period, setPeriod] = useState<Period | null>(null);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [data, setData] = useState<DataState>({ result: null, error: null, loading: true });
  const [exporting, setExporting] = useState<string | null>(null);
  const [sheet, setSheet] = useState<ReportCard | null>(null);
  // An authenticated CSV retained after download starts, for preview, copy or a fresh retry (FR-SYS-144).
  const [prepared, setPrepared] = useState<{ card: ReportCard; file: File; text: string; period: Period } | null>(null);
  const preview = useMemo(() => {
    if (!prepared) return null;
    const rows = parseCsv(prepared.text).filter((r) => r.some((c) => c !== ""));
    return { rows: rows.slice(0, PREVIEW_ROWS), total: rows.length };
  }, [prepared]);
  const pages = useRef<Record<string, number>>({});
  const seq = useRef(0);
  const active = useRef(true);
  const currentPeriod = useRef<Period | null>(null);
  const download = useRef<AbortController | null>(null);
  const cancelDownloads = useCallback(() => {
    download.current?.abort();
    download.current = null;
    setExporting(null);
    setPrepared(null); // a prepared file belongs to the old version, account or page
  }, []);

  // Only the latest answer lands. Non-auth failures may retain marked older data;
  // an authorization refusal also closes details and clears statistics immediately.
  const load = useCallback(
    async (p: Period | null, refresh: boolean, requestedPages = pages.current, pinnedPeriod?: Period) => {
      const n = ++seq.current;
      setData((d) => ({ ...d, loading: true, error: null }));
      try {
        const result = await reportData(detail.id, pinnedPeriod ?? p, refresh, requestedPages);
        if (n !== seq.current) return;
        if (result.report_version !== version) {
          cancelDownloads();
          setSheet(null);
          setData({ result: null, error: null, loading: true });
          onStale(); // do not render a new snapshot's values against the old definitions
          return;
        }
        setData({ result, error: null, loading: false });
      } catch (error) {
        if (n !== seq.current) return;
        const unavailable = error instanceof ApiError &&
          ([401, 403, 404].includes(error.status) || error.code === "report_not_published");
        if (unavailable) {
          seq.current += 1;
          cancelDownloads();
          setSheet(null);
        }
        setData((d) => ({ result: unavailable ? null : d.result, error, loading: false }));
      }
    },
    [detail.id, version, onStale, cancelDownloads],
  );

  useEffect(() => {
    void load(period, false);
  }, [load, period, version]);

  useLayoutEffect(() => {
    currentPeriod.current = period;
  }, [period]);

  useLayoutEffect(() => {
    // A newly published configuration invalidates the old values and details before paint,
    // without resetting the viewer's selected period.
    pages.current = {};
    seq.current += 1;
    cancelDownloads();
    setSheet(null);
    setData({ result: null, error: null, loading: true });
  }, [version, cancelDownloads]);

  useLayoutEffect(() => {
    if (!detail.can_export) cancelDownloads();
  }, [detail.can_export, cancelDownloads]);

  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      seq.current += 1;
      cancelDownloads(); // discard the file when leaving the tenant/page
    };
  }, [cancelDownloads]);

  // Do not expose an older snapshot during the commit preceding layout cleanup.
  const result = data.result?.report_version === version ? data.result : null;
  const stale = result !== null && data.error !== null;
  const byCard = useMemo(() => {
    const map = new Map<string, CardResult>();
    for (const c of result?.cards ?? []) if (c.card_id) map.set(c.card_id, c);
    return map;
  }, [result]);

  const both = from !== "" && to !== "";
  const ordered = both && from <= to;
  const apply = () => {
    if (ordered) {
      pages.current = {};
      setPeriod({ from, to });
    }
  };
  const reset = () => {
    pages.current = {};
    setFrom("");
    setTo("");
    setPeriod(null);
  };

  const titleOf = (card: ReportCard) => card.title?.trim() || labels.chart.chartTypes[card.type];

  const exportCard = async (card: ReportCard) => {
    if (!result || !detail.can_export || download.current) return; // one authorized export at a time
    setPrepared(null);
    const controller = new AbortController();
    download.current = controller;
    setExporting(card.id);
    try {
      // Pin the effective displayed period rather than re-resolving a moving default.
      const shown = result.period;
      const out = await downloadCsv(authLiff(), detail.id, card.id, shown, version, controller.signal);
      if (!active.current || controller.signal.aborted) return;
      if (out.how === "prepared") setPrepared({ card, file: out.file, text: out.text, period: shown });
      else showToast(t("rpt.csvReady"));
    } catch (e) {
      if (!active.current || controller.signal.aborted) return;
      // A refresh changes the data sequence, not the authority of a pending CSV refusal.
      if (e instanceof ApiError &&
        ([401, 403, 404].includes(e.status) || e.code === "report_not_published" || e.code === "revision_conflict")) {
        seq.current += 1;
        cancelDownloads();
        setSheet(null);
        setData({ result: null, error: e, loading: false });
        onStale();
        // Recheck view separately, with the current selection rather than the export's old period.
        void load(currentPeriod.current, true);
      }
      // a card over the limits or timed out: say why instead of a partial file (FR-REPORT-016)
      const code = e instanceof ApiError && e.code === "report_export_failed" ? e.details?.error_code : null;
      const why = typeof code === "string" ? labels.chart.errors[code] : undefined;
      showToast(why ? `${t("rpt.exportFailed")} ${why}` : errorMessage(e, t));
    } finally {
      if (download.current === controller) {
        download.current = null;
        if (active.current) setExporting(null);
      }
    }
  };

  // Straight from the tap: iOS only lets the clipboard be written with user activation.
  const copyPrepared = (e: MouseEvent<HTMLButtonElement>) => {
    if (!prepared || !detail.can_export) return;
    void copyText(prepared.text, e.currentTarget.parentElement ?? document.body).then((ok) => {
      if (active.current) showToast(t(ok ? "rpt.csvCopied" : "rpt.csvCopyFailed"));
    });
  };

  const notPublished = data.error instanceof ApiError && data.error.code === "report_not_published";
  if (notPublished) {
    return (
      <EmptyState status="notFound" title={t("rpt.unpublishedNow")}>
        <Button onClick={() => navigate("/report")}>{t("rpt.backToList")}</Button>
      </EmptyState>
    );
  }

  const renderCard = (card: ReportCard) => {
    const r = byCard.get(card.id) ?? null;
    const title = titleOf(card);
    const info = (
      <ReportCardInfo
        card={card}
        sources={detail.sources}
        result={r}
        labels={labels.info}
        actions={
          <>
            <button
              type="button"
              className={s["card-action"]}
              aria-label={t("rpt.detailsOf", { title })}
              aria-haspopup="dialog"
              onClick={() => setSheet(card)}
            >
              {t("rpt.details")}
            </button>
            {detail.can_export && (
              <button
                type="button"
                className={s["card-action"]}
                disabled={!r || r.status === "error" || stale || data.loading || exporting !== null}
                aria-busy={exporting === card.id || undefined}
                aria-label={t("rpt.csvOf", { title })}
                onClick={() => void exportCard(card)}
              >
                {t("rpt.csv")}
              </button>
            )}
          </>
        }
      />
    );
    return (
      <ChartRenderer
        card={card}
        result={r}
        loading={!result && data.loading}
        labels={labels.chart}
        locale={labels.locale}
        headingLevel={2}
        onRetry={() => void load(period, true)}
        onPageChange={result && !data.loading && !stale ? (page) => {
          pages.current = { ...pages.current, [card.id]: page };
          void load(period, false, pages.current, result.period);
        } : undefined}
        footer={card.type === "image" || card.type === "html" ? undefined : info}
        loadAsset={loadAsset}
        embedOrigins={contentPolicy.data?.origins}
        palette={REPORT_PALETTES[config.appearance?.theme ?? "brand"]}
      />
    );
  };

  const scope = result ? (result.scope === "all" ? t("rpt.scope.all") : t("rpt.scope.own")) : null;
  const sheetResult = sheet ? (byCard.get(sheet.id) ?? null) : null;

  return (
    <>
      <p className={s.meta}>{t("rpt.publishedMeta", { n: version, at: formatBangkokDateTime(detail.published.published_at) })}</p>
      <section className={s.panel} aria-label={t("rpt.periodBar")}>
        <div className={s["panel-head"]}>
          <h2 className={s["panel-title"]}>{t("rpt.periodOverride")}</h2>
          <Button
            variant="primary"
            size="sm"
            loading={data.loading && result !== null}
            onClick={() => void load(period, true)}
          >
            {!(data.loading && result !== null) && <RotateCw size={14} strokeWidth={2} aria-hidden="true" />}
            {t("rpt.refresh")}
          </Button>
        </div>
        <div className={s.dates}>
          <label className={s.date}>
            {t("rpt.periodFrom")}
            <input type="date" value={from} max={to || undefined} onChange={(e) => setFrom(e.target.value)} />
          </label>
          <label className={s.date}>
            {t("rpt.periodTo")}
            <input type="date" value={to} min={from || undefined} onChange={(e) => setTo(e.target.value)} />
          </label>
        </div>
        {both && !ordered && <p className={s.hint} role="alert">{t("rpt.periodOrder")}</p>}
        <div className={s.actions}>
          <Button size="sm" disabled={!ordered} onClick={apply}>
            {t("rpt.applyPeriod")}
          </Button>
          <Button size="sm" disabled={period === null && from === "" && to === ""} onClick={reset}>
            {t("rpt.resetPeriod")}
          </Button>
        </div>
        {result && (
          <dl className={s.facts} aria-live="polite">
            <dt>{t("rpt.actualPeriod")}</dt>
            <dd>
              {result.period.from} – {result.period.to}
              {period === null && ` (${t("rpt.periodAsPublished")})`}
            </dd>
            <dt>{t("rpt.scope")}</dt>
            <dd>{scope}</dd>
            <dt>{t("rpt.generatedAt")}</dt>
            <dd>{formatBangkokDateTime(result.generated_at)}</dd>
          </dl>
        )}
        <p className={s.note}>{t("rpt.noAutoRefresh")}</p>
      </section>
      {stale && (
        <div role="alert">
          <Alert tone="warning" className={s["alert-row"]}>
            <p className={s["alert-title"]}>{t("rpt.staleTitle")}</p>
            <p className={s["alert-body"]}>
              {t("rpt.staleBody", { at: formatBangkokDateTime(result.generated_at) })} {errorMessage(data.error, t)}
            </p>
            <Button size="sm" onClick={() => void load(period, true)}>
              {t("common.retry")}
            </Button>
          </Alert>
        </div>
      )}
      {!result && data.error !== null ? (
        <EmptyState status="error" title={t("rpt.loadFailed")} description={errorMessage(data.error, t)}>
          <Button variant="primary" onClick={() => void load(period, true)}>
            {t("common.retry")}
          </Button>
        </EmptyState>
      ) : config.cards.length === 0 ? (
        <EmptyState status="empty" title={t("rpt.noCards")} />
      ) : (
        <div className={`${s.cards} ${stale ? s.stale : ""}`} aria-busy={data.loading || undefined}>
          <ReportGrid
            mode="stack"
            appearance={config.appearance}
            cards={config.cards}
            labels={labels.grid}
            stackItemHeight={stackHeight}
            renderCard={renderCard}
          />
        </div>
      )}
      <span className={s["sr-only"]} role="status">
        {data.loading && result !== null ? t("rpt.refreshing") : ""}
      </span>
      <BottomSheet
        open={sheet !== null}
        onClose={() => setSheet(null)}
        label={sheet ? t("rpt.detailsOf", { title: titleOf(sheet) }) : t("rpt.details")}
      >
        {sheet && (
          <>
            <h2 className={s["sheet-title"]}>{titleOf(sheet)}</h2>
            <div className={s["sheet-body"]}>
              <ReportCardDetails card={sheet} sources={detail.sources} result={sheetResult} labels={labels.info} />
            </div>
            <Button block className={s["sheet-close"]} onClick={() => setSheet(null)}>
              {t("common.close")}
            </Button>
          </>
        )}
      </BottomSheet>
      <BottomSheet open={prepared !== null} onClose={() => setPrepared(null)} label={t("rpt.csvPrepared")}>
        {prepared && (
          <>
            <h2 className={s["sheet-title"]}>{t("rpt.csvPrepared")}</h2>
            <p className={s["sheet-body"]}>
              {t("rpt.csvPreparedBody", {
                title: titleOf(prepared.card),
                from: prepared.period.from,
                to: prepared.period.to,
              })}
            </p>
            {preview && preview.rows.length > 0 && (
              <>
                <div className={s["csv-preview"]} role="region" aria-label={t("rpt.csvPreview")} tabIndex={0}>
                  <table>
                    <tbody>
                      {preview.rows.map((row, i) => (
                        <tr key={i}>
                          {row.map((cell, j) => (
                            <td key={j}>{cell}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                {preview.total > preview.rows.length && (
                  <p className={s.note}>{t("rpt.csvPreviewMore", { n: preview.rows.length, total: preview.total })}</p>
                )}
              </>
            )}
            <div className={s["sheet-actions"]}>
              <Button
                variant="primary"
                block
                disabled={!result || stale || data.loading || !detail.can_export || exporting !== null}
                onClick={() => void exportCard(prepared.card)}
              >
                {t("rpt.csvDownload")}
              </Button>
              <Button variant="outline" block onClick={copyPrepared}>
                {t("rpt.csvCopy")}
              </Button>
              <Button variant="ghost" block onClick={() => setPrepared(null)}>
                {t("common.close")}
              </Button>
            </div>
          </>
        )}
      </BottomSheet>
    </>
  );
}

/** /report/:id: one published report on the viewer's own data scope, its cards in one column
 * by the PC order (y, x, card id), queried on open and on a manual refresh only
 * (FR-SYS-056, FR-REPORT-002, -010, -015, -016, -018). Read only: no designer. */
export function ReportDetailPage() {
  const t = useT();
  const navigate = useNavigate();
  const { tenant } = useCurrentTenant();
  const id = Number(useParams().id);
  const report = useReport(id);
  const detail = report.data;
  const { refetch } = report;
  const onStale = useCallback(() => void refetch(), [refetch]);
  const title = detail?.published?.name ?? t("nav.report");

  let body;
  if (!Number.isInteger(id) || id <= 0) {
    body = <EmptyState status="notFound" title={t("rpt.notFound")} />;
  } else if (report.isPending) {
    body = <BrandLoading variant="inline" label={t("common.loading")} />;
  } else if (report.isError) {
    body =
      report.error instanceof ApiError && report.error.status === 404 ? (
        <EmptyState status="notFound" title={t("rpt.notFound")}>
          <Button onClick={() => navigate("/report")}>{t("rpt.backToList")}</Button>
        </EmptyState>
      ) : (
        <EmptyState status="error" title={t("rpt.loadFailed")} description={errorMessage(report.error, t)}>
          <Button variant="primary" loading={report.isFetching} onClick={() => void refetch()}>
            {t("common.retry")}
          </Button>
        </EmptyState>
      );
  } else if (!detail?.published) {
    body = (
      <EmptyState status="notFound" title={t("rpt.notPublishedYet")}>
        <Button onClick={() => navigate("/report")}>{t("rpt.backToList")}</Button>
      </EmptyState>
    );
  } else {
    // a new account or report starts from a clean page: nothing of the previous one shows
    body = (
      <Viewer
        key={`${tenant?.tenant_id}:${detail.id}`}
        detail={detail as ReportDetail & { published: Published }}
        onStale={onStale}
      />
    );
  }

  return (
    <div className={`${theme.scan} ${s.page} ${s.detail}`}>
      <PageHeader title={title} onBack={() => navigate("/report")} />
      <div className={s.content}>{body}</div>
    </div>
  );
}
