import {
  ChartRenderer,
  ReportCardDetails,
  ReportCardInfo,
  ReportGrid,
  type CardResult,
  type QueryResult,
  type ReportCard,
} from "@saiflow/ui";
import { Alert, App, Button, DatePicker, Popover, Result, Space, Spin, Tag } from "antd";
import type { Dayjs } from "dayjs";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { ErrorText } from "../components/ErrorText";
import { Page } from "../components/Page";
import { formatBangkokDateTime } from "../format";
import { useT } from "../i18n";
import { Icon } from "../layout/icons";
import { configOf, downloadCsv, reportData, useReport, type Period, type ReportDetail } from "../reports/api";
import { ReportGate } from "../reports/common";
import { useReportLabels } from "../reports/labels";
import { ApiError, errorMessage } from "../services/errors";

const DAY = "YYYY-MM-DD";

/** The list this report was opened from: "View reports" (/report-view) or "Manage reports"
 * (/reports); back links return there and the page keeps its menu item (FR-SYS-160). */
function useListPath(): string {
  return useLocation().pathname.startsWith("/report-view") ? "/report-view" : "/reports";
}

/** The last answer of the data endpoint, and whether a later attempt failed (FR-REPORT-015). */
interface DataState {
  result: QueryResult | null;
  error: unknown;
  loading: boolean;
}

function Viewer({ detail, onStale }: { detail: ReportDetail & { published: NonNullable<ReportDetail["published"]> }; onStale(): void }) {
  const t = useT();
  const navigate = useNavigate();
  const listPath = useListPath();
  const { message } = App.useApp();
  const labels = useReportLabels();
  const config = useMemo(() => configOf(detail.published.config), [detail.published.config]);
  const version = detail.published.version;

  // the whole-page period: null = as published (FR-REPORT-010)
  const [period, setPeriod] = useState<Period | null>(null);
  const [range, setRange] = useState<[Dayjs | null, Dayjs | null] | null>(null);
  const [data, setData] = useState<DataState>({ result: null, error: null, loading: true });
  const [exporting, setExporting] = useState<ReadonlySet<string>>(() => new Set());
  const seq = useRef(0);
  const active = useRef(true);
  const currentPeriod = useRef<Period | null>(null);
  const downloads = useRef(new Map<string, AbortController>());
  const cancelDownloads = useCallback(() => {
    for (const controller of downloads.current.values()) controller.abort();
    downloads.current.clear();
    setExporting(new Set());
  }, []);

  // Only the latest answer lands. Non-auth failures may retain marked older data;
  // an authorization refusal clears statistics and diagnostics immediately.
  const load = useCallback(
    async (p: Period | null, refresh: boolean) => {
      const n = ++seq.current;
      setData((d) => ({ ...d, loading: true, error: null }));
      try {
        const result = await reportData(detail.id, p, refresh);
        if (n !== seq.current) return;
        if (result.report_version !== version) {
          cancelDownloads();
          setData({ result: null, error: null, loading: true });
          onStale(); // never draw a new snapshot's values with the old card definitions
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
    // Metadata can advance before the data endpoint answers; preserve the selected period,
    // but invalidate old values, requests and downloads before the new definitions paint.
    seq.current += 1;
    cancelDownloads();
    setData({ result: null, error: null, loading: true });
  }, [version, cancelDownloads]);

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
    if (!result || downloads.current.has(card.id)) return;
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
        ([401, 403, 404].includes(e.status) || e.code === "report_not_published" || e.code === "revision_conflict")) {
        seq.current += 1;
        cancelDownloads();
        setData({ result: null, error: e, loading: false });
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
        onRetry={() => void load(period, true)}
        footer={info}
      />
    );
  };

  return (
    <Page
      name={listPath === "/report-view" ? "report-view" : "reports"}
      title={detail.published.name}
      badge={<Tag>{t("rpt.version", { n: version })}</Tag>}
      meta={<span>{t("rpt.publishedAt", { at: formatBangkokDateTime(detail.published.published_at) })}</span>}
      extra={
        <Space wrap>
          <Button icon={<Icon name="back" />} onClick={() => navigate(listPath)}>
            {t("rpt.backToList")}
          </Button>
          {detail.can_manage && <Button onClick={() => navigate(`/reports/${detail.id}/design`)}>{t("rpt.design")}</Button>}
          <Button type="primary" aria-label={t("rpt.refresh")} loading={data.loading && result !== null} onClick={() => void load(period, true)}>
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
                {period === null && <span className="pc-report-bar__hint"> ({t("rpt.periodAsPublished")})</span>}
              </dd>
            </div>
            <div>
              <dt>{t("rpt.scope")}</dt>
              <dd>{scope}</dd>
            </div>
            <div>
              <dt>{t("rpt.generatedAt")}</dt>
              <dd>{formatBangkokDateTime(result.generated_at)}</dd>
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
            <Button size="small" onClick={() => void load(period, true)}>
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
            <Button size="small" onClick={() => void load(period, true)}>
              {t("common.retry")}
            </Button>
          }
        />
      )}
      {config.cards.length === 0 ? (
        <Result status="info" title={t("rpt.noCards")} />
      ) : (
        (result || data.loading) && (
          <div className={stale ? "pc-report-view is-stale" : "pc-report-view"} aria-busy={data.loading || undefined}>
            <ReportGrid
              mode="view"
              cards={config.cards}
              rowHeight={config.grid?.row_height ?? 80}
              labels={labels.grid}
              renderCard={renderCard}
              fallback={<Spin />}
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

function ViewLoader() {
  const t = useT();
  const navigate = useNavigate();
  const listPath = useListPath();
  const id = Number(useParams().id);
  const report = useReport(id);
  const { refetch } = report;
  const onStale = useCallback(() => void refetch(), [refetch]);
  if (report.isPending) return <Spin />;
  if (report.error) {
    if (report.error instanceof ApiError && report.error.status === 404) return <Result status="404" title={t("rpt.notFound")} />;
    return <ErrorText error={report.error} />;
  }
  const detail = report.data;
  if (!detail.published) {
    return (
      <Result
        status="info"
        title={t("rpt.notPublishedYet")}
        extra={
          <Space>
            <Button onClick={() => navigate(listPath)}>{t("rpt.backToList")}</Button>
            {detail.can_manage && (
              <Button type="primary" onClick={() => navigate(`/reports/${detail.id}/design`)}>
                {t("rpt.design")}
              </Button>
            )}
          </Space>
        }
      />
    );
  }
  return <Viewer key={`${detail.tenant_id}:${detail.id}`} detail={detail as ReportDetail & { published: NonNullable<ReportDetail["published"]> }} onStale={onStale} />;
}

/** /reports/:id: one published report on the viewer's own data scope, queried on open and on
 * a manual refresh only (FR-REPORT-002, -010, -015, -016, -018). */
export function ReportViewPage() {
  return (
    <ReportGate need="view">
      <ViewLoader />
    </ReportGate>
  );
}
