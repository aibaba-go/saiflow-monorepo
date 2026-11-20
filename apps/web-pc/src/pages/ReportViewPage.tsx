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
import { Alert, App, Button, DatePicker, Popover, Result, Space, Spin, Tag } from "antd";
import type { Dayjs } from "dayjs";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { Page } from "../components/Page";
import { formatBangkokDateTime } from "../format";
import { useT } from "../i18n";
import { Icon } from "../layout/icons";
import { configOf, downloadCsv, readReportAsset, reportData, useHomepageChoice, useReport, useReportContentPolicy, type Period, type ReportDetail } from "../reports/api";
import { ReportGate, useReportAccess } from "../reports/common";
import { useReportLabels } from "../reports/labels";
import { ApiError, errorMessage } from "../services/errors";

const DAY = "YYYY-MM-DD";

/** The list this report was opened from: "View reports" (/report-view) or "Manage reports"
 * (/reports); back links return there and the page keeps its menu item (FR-SYS-160). */
function useListPath(): string {
  return useLocation().pathname.startsWith("/report-view") ? "/report-view" : "/reports";
}

/** The last answer and its selection source, even if a later attempt failed (FR-SYS-163/164). */
interface DataState {
  result: QueryResult | null;
  periodSource: "published" | "override" | null;
  error: unknown;
  loading: boolean;
}

function Viewer({ detail, onStale, fallback }: { detail: ReportDetail & { published: NonNullable<ReportDetail["published"]> }; onStale(): void; fallback?: ReactNode }) {
  const t = useT();
  const navigate = useNavigate();
  const listPath = useListPath();
  const { message } = App.useApp();
  const labels = useReportLabels();
  const homepage = useHomepageChoice();
  const home = fallback !== undefined;
  const chooseHome = async (id: number | null) => {
    try { await homepage.choose(id); void message.success(t("rpt.homeSaved")); }
    catch (e) { void message.error(errorMessage(e, t)); }
  };
  const loadAsset = useCallback((id: string, signal: AbortSignal) => readReportAsset(id, detail.id, signal), [detail.id, detail.tenant_id]);
  const config = useMemo(() => configOf(detail.published.config), [detail.published.config]);
  const contentPolicy = useReportContentPolicy(config.cards.some((card) => card.type === "html" && card.content?.mode === "url"));
  const version = detail.published.version;
  const publication = useMemo(() => ({ tenantId: detail.tenant_id, id: detail.id, version }), [detail.tenant_id, detail.id, version]);

  // the whole-page period: null = as published (FR-REPORT-010)
  const [period, setPeriod] = useState<Period | null>(null);
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [data, setData] = useState<DataState>({ result: null, periodSource: null, error: null, loading: true });
  const [exporting, setExporting] = useState<ReadonlySet<string>>(() => new Set());
  const seq = useRef(0);
  const active = useRef(true);
  const currentPublication = useRef(publication);
  const canExport = useRef(detail.can_export);
  const currentPeriod = useRef<Period | null>(null);
  const downloads = useRef(new Map<string, AbortController>());
  const cancelDownloads = useCallback(() => {
    for (const controller of downloads.current.values()) controller.abort();
    downloads.current.clear();
    setExporting(new Set());
  }, []);

  // Only the latest ordinary answer lands. A refusal invalidates even newer period
  // requests, but only within this active viewer's current publication (FR-SYS-164).
  const load = useCallback(
    async (p: Period | null, refresh: boolean) => {
      if (!active.current || currentPublication.current !== publication) return;
      const n = ++seq.current;
      setData((d) => ({ ...d, loading: true, error: null }));
      try {
        const result = await reportData(detail.id, p, refresh);
        if (!active.current || currentPublication.current !== publication || n !== seq.current) return;
        if (result.report_version !== version) {
          cancelDownloads();
          setData({ result: null, periodSource: null, error: null, loading: true });
          onStale(); // never draw a new snapshot's values with the old card definitions
          return;
        }
        setData({ result, periodSource: p === null ? "published" : "override", error: null, loading: false });
      } catch (error) {
        if (!active.current || currentPublication.current !== publication) return;
        const conflict = error instanceof ApiError && error.code === "revision_conflict";
        const unavailable = error instanceof ApiError &&
          ([401, 402, 403, 404].includes(error.status) || error.code === "report_not_published" || conflict);
        if (unavailable) {
          seq.current += 1;
          cancelDownloads();
          setData({ result: null, periodSource: null, error, loading: false });
          if (conflict) onStale(); // recheck the publication before mixing definitions and values
          return;
        }
        if (n !== seq.current) return;
        setData((d) => ({ ...d, error, loading: false }));
      }
    },
    [detail.id, version, publication, onStale, cancelDownloads],
  );

  useEffect(() => {
    void load(period, false);
  }, [load, period, version]);

  useLayoutEffect(() => {
    currentPeriod.current = period;
  }, [period]);

  useLayoutEffect(() => {
    // Metadata can advance before the data endpoint answers; preserve the selected period,
    // but invalidate old values, requests and downloads before the new definitions paint.
    currentPublication.current = publication;
    seq.current += 1;
    cancelDownloads();
    setData({ result: null, periodSource: null, error: null, loading: true });
  }, [publication, cancelDownloads]);

  useLayoutEffect(() => {
    canExport.current = detail.can_export;
    if (!detail.can_export) cancelDownloads(); // export can be revoked without a new publication
  }, [detail.can_export, cancelDownloads]);

  useLayoutEffect(() => {
    active.current = true;
    return () => {
      active.current = false;
      seq.current += 1;
      cancelDownloads(); // invalidate before a departed viewer can deliver a file
    };
  }, [cancelDownloads]);

  // A render-time gate also covers the commit before layout/effect cleanup.
  const result = data.result?.report_version === version ? data.result : null;
  const stale = result !== null && data.error !== null;
  const byCard = useMemo(() => {
    const map = new Map<string, CardResult>();
    for (const c of result?.cards ?? []) if (c.card_id) map.set(c.card_id, c);
    return map;
  }, [result]);

  const rangeOk = !!range?.[0] && !!range?.[1] && !range[0].isAfter(range[1], "day");
  const apply = () => {
    if (!rangeOk || !range?.[0] || !range[1]) return;
    setPeriod({ from: range[0].format(DAY), to: range[1].format(DAY) });
  };
  const reset = () => {
    setRange(null);
    setPeriod(null);
  };

  const exportCard = async (card: ReportCard) => {
    if (!active.current || currentPublication.current !== publication || !canExport.current || !result || downloads.current.has(card.id)) return;
    const controller = new AbortController();
    downloads.current.set(card.id, controller);
    setExporting((ids) => new Set(ids).add(card.id));
    try {
      // Pin the effective displayed period, including a default year resolved before midnight.
      await downloadCsv(detail.id, card.id, result.period, version, controller.signal);
    } catch (e) {
      if (!active.current || controller.signal.aborted) return;
      // A refresh changes the data sequence, not the authority of a pending CSV refusal.
      if (e instanceof ApiError &&
        ([401, 402, 403, 404].includes(e.status) || e.code === "report_not_published" || e.code === "revision_conflict")) {
        seq.current += 1;
        cancelDownloads();
        setData({ result: null, periodSource: null, error: e, loading: false });
        onStale();
        // Recheck view separately, with today's selection rather than the export's old period.
        void load(currentPeriod.current, true);
      }
      // a card over the limits or timed out: say why instead of a partial file (FR-REPORT-016)
      const code = e instanceof ApiError && e.code === "report_export_failed" ? e.details?.error_code : null;
      const why = typeof code === "string" ? labels.chart.errors[code] : undefined;
      void message.error(why ? `${t("rpt.exportFailed")} ${why}` : errorMessage(e, t));
    } finally {
      if (downloads.current.get(card.id) === controller) {
        downloads.current.delete(card.id);
        if (active.current) setExporting((ids) => {
          const next = new Set(ids);
          next.delete(card.id);
          return next;
        });
      }
    }
  };

  if (home && data.error instanceof ApiError && ([402, 403, 404].includes(data.error.status) || data.error.code === "report_not_published")) return <>{fallback}</>;
  const notPublished = data.error instanceof ApiError && data.error.code === "report_not_published";
  if (notPublished) {
    return (
      <Result
        status="info"
        title={t("rpt.unpublishedNow")}
        extra={<Button onClick={() => navigate(listPath)}>{t("rpt.backToList")}</Button>}
      />
    );
  }

  const scope = result ? (result.scope === "all" ? t("rpt.scope.all") : t("rpt.scope.own")) : null;

  const renderCard = (card: ReportCard) => {
    const r = byCard.get(card.id) ?? null;
    const info = (
      <ReportCardInfo
        card={card}
        sources={detail.sources}
        result={r}
        labels={labels.info}
        actions={
          <>
            <Popover
              trigger="click"
              title={card.title?.trim() || labels.chart.chartTypes[card.type]}
              content={
                <div className="pc-report-details">
                  <ReportCardDetails card={card} sources={detail.sources} result={r} labels={labels.info} />
                </div>
              }
            >
              <Button size="small" type="text">
                {t("rpt.details")}
              </Button>
            </Popover>
            {detail.can_export && (
              <Button
                size="small"
                type="text"
                loading={exporting.has(card.id)}
                disabled={!r || r.status === "error" || stale || data.loading || exporting.has(card.id)}
                aria-label={t("rpt.csvOf", { title: card.title?.trim() || labels.chart.chartTypes[card.type] })}
                onClick={() => void exportCard(card)}
              >
                {t("rpt.csv")}
              </Button>
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
        locale={t("format.locale")}
        onRetry={data.loading ? undefined : () => void load(period, true)}
        footer={card.type === "image" || card.type === "html" ? undefined : info}
        loadAsset={loadAsset}
        embedOrigins={contentPolicy.data?.origins}
        palette={REPORT_PALETTES[config.appearance?.theme ?? "brand"]}
      />
    );
  };

  const gridLoading = (
    <div className="pc-panel pc-report-status" role="status" aria-label={t("rpg.grid")} aria-busy="true">
      <Spin aria-hidden="true" />
      <span>{t("rpc.loading")}</span>
    </div>
  );

  return (
    <Page
      name={home ? "home" : listPath === "/report-view" ? "report-view" : "reports"}
      title={detail.published.name}
      description={t("rpt.readOnlyNote")}
      badge={<Tag className="pc-report-version">{t("rpt.version", { n: version })}</Tag>}
      meta={<time dateTime={detail.published.published_at}>{t("rpt.publishedAt", { at: formatBangkokDateTime(detail.published.published_at) })}</time>}
      extra={
        <Space wrap>
          {!home && <Button icon={<Icon name="back" />} onClick={() => navigate(listPath)}>{t("rpt.backToList")}</Button>}
          {!home && listPath === "/reports" && detail.can_manage && <Button onClick={() => navigate(`/reports/${detail.id}/design`)}>{t("rpt.design")}</Button>}
          <Button loading={homepage.pending} disabled={homepage.pending} onClick={() => void chooseHome(home ? null : detail.id)}>
            {t(home ? "rpt.resetHome" : "rpt.setHome")}
          </Button>
          <Button type="primary" aria-label={t("rpt.refresh")} loading={data.loading} disabled={data.loading} onClick={() => void load(period, true)}>
            {t("rpt.refresh")}
          </Button>
        </Space>
      }
    >
      <section className="pc-panel pc-report-bar" aria-label={t("rpt.periodBar")}>
        <div className="pc-report-bar__period">
          <span className="pc-report-bar__label">{t("rpt.periodOverride")}</span>
          <DatePicker.RangePicker
            aria-label={t("rpt.periodOverride")}
            value={range}
            placeholder={[t("rpt.periodFrom"), t("rpt.periodTo")]}
            onChange={(v) => setRange(v as [Dayjs | null, Dayjs | null] | null)}
          />
          <Button disabled={!rangeOk} onClick={apply}>
            {t("rpt.applyPeriod")}
          </Button>
          <Button disabled={period === null && range === null} onClick={reset}>
            {t("rpt.resetPeriod")}
          </Button>
        </div>
        {result && (
          <dl className="pc-report-bar__facts" aria-live="polite">
            <div>
              <dt>{t("rpt.actualPeriod")}</dt>
              <dd>
                {result.period.from} – {result.period.to}
                {data.periodSource === "published" && <span className="pc-report-bar__hint"> ({t("rpt.periodAsPublished")})</span>}
              </dd>
            </div>
            <div>
              <dt>{t("rpt.scope")}</dt>
              <dd>{scope}</dd>
            </div>
            <div>
              <dt>{t("rpt.generatedAt")}</dt>
              <dd><time dateTime={result.generated_at}>{formatBangkokDateTime(result.generated_at)}</time></dd>
            </div>
          </dl>
        )}
        <span className="pc-report-bar__note">{t("rpt.noAutoRefresh")}</span>
      </section>
      {stale && (
        <Alert
          role="alert"
          type="warning"
          showIcon
          message={t("rpt.staleTitle")}
          description={
            <>
              {t("rpt.staleBody", { at: formatBangkokDateTime(result.generated_at) })} {errorMessage(data.error, t)}
            </>
          }
          action={
            <Button size="small" disabled={data.loading} onClick={() => void load(period, true)}>
              {t("common.retry")}
            </Button>
          }
        />
      )}
      {!result && data.error !== null && (
        <Alert
          role="alert"
          type="error"
          showIcon
          message={t("rpt.loadFailed")}
          description={errorMessage(data.error, t)}
          action={
            <Button size="small" disabled={data.loading} onClick={() => void load(period, true)}>
              {t("common.retry")}
            </Button>
          }
        />
      )}
      {config.cards.length === 0 ? (
        result ? <Result status="info" title={t("rpt.noCards")} /> : data.loading && gridLoading
      ) : (
        (result || data.loading) && (
          <div className={stale ? "pc-report-view is-stale" : "pc-report-view"} aria-busy={data.loading || undefined}>
            <ReportGrid
              mode="view"
              appearance={config.appearance}
              cards={config.cards}
              rowHeight={config.grid?.row_height ?? 80}
              labels={labels.grid}
              renderCard={renderCard}
              fallback={gridLoading}
            />
          </div>
        )
      )}
      <span className="sf-visually-hidden" role="status">
        {data.loading && result !== null ? t("rpt.refreshing") : ""}
      </span>
    </Page>
  );
}

function ViewLoader({ reportId, fallback }: { reportId?: number; fallback?: ReactNode } = {}) {
  const t = useT();
  const navigate = useNavigate();
  const listPath = useListPath();
  const pathId = useParams().id;
  const id = reportId ?? Number(pathId);
  const report = useReport(id);
  const { refetch } = report;
  const onStale = useCallback(() => void refetch(), [refetch]);
  if (report.isPending || (report.error && report.isFetching)) {
    return <div className="pc-panel pc-report-status" role="status" aria-busy="true"><Spin aria-hidden="true" /><span>{t("rpc.loading")}</span></div>;
  }
  if (report.error) {
    if (fallback !== undefined && report.error instanceof ApiError && ([402, 403, 404].includes(report.error.status) || report.error.code === "report_not_published")) return <>{fallback}</>;
    if (report.error instanceof ApiError && report.error.status === 404) {
      return <Result status="404" title={t("rpt.notFound")} extra={<Button onClick={() => navigate(listPath)}>{t("rpt.backToList")}</Button>} />;
    }
    return (
      <Alert
        role="alert"
        type="error"
        showIcon
        message={t("rpt.loadFailed")}
        description={errorMessage(report.error, t)}
        action={<Button onClick={() => void refetch()}>{t("common.retry")}</Button>}
      />
    );
  }
  const detail = report.data;
  if (!detail.published) {
    if (fallback !== undefined) return <>{fallback}</>;
    return (
      <Result
        status="info"
        title={t("rpt.notPublishedYet")}
        extra={
          <Space wrap>
            <Button onClick={() => navigate(listPath)}>{t("rpt.backToList")}</Button>
            {listPath === "/reports" && detail.can_manage && (
              <Button type="primary" onClick={() => navigate(`/reports/${detail.id}/design`)}>
                {t("rpt.design")}
              </Button>
            )}
          </Space>
        }
      />
    );
  }
  return <Viewer key={`${detail.tenant_id}:${detail.id}`} detail={detail as ReportDetail & { published: NonNullable<ReportDetail["published"]> }} onStale={onStale} fallback={fallback} />;
}

/** /reports/:id: one published report on the viewer's own data scope, queried on open and on
 * a manual refresh only (FR-REPORT-002, -010, -015, -016, -018). */
export function HomepageReport({ id, fallback }: { id: number; fallback: ReactNode }) {
  const t = useT();
  const { access, loading, error, retry } = useReportAccess();
  if (loading) return <Spin />;
  if (error) return <Alert role="alert" type="error" message={t("rpt.loadFailed")} description={errorMessage(error, t)} action={<Button onClick={() => void retry()}>{t("common.retry")}</Button>} />;
  if (!access.view) return <>{fallback}</>;
  return <ViewLoader key={id} reportId={id} fallback={fallback} />;
}

export function ReportViewPage() {
  return (
    <ReportGate need="view">
      <ViewLoader />
    </ReportGate>
  );
}
