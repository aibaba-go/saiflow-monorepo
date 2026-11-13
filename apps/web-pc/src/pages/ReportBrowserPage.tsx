import { Alert, Button, Empty, Skeleton } from "antd";
import { Link } from "react-router-dom";

import { Page } from "../components/Page";
import { formatBangkokDateTime } from "../format";
import { useT } from "../i18n";
import { Icon } from "../layout/icons";
import { useReports } from "../reports/api";
import { ReportGate } from "../reports/common";
import { errorMessage } from "../services/errors";

/** Decorative accents distinguish reports, not their status or chart palette. */
const TONES = ["teal", "indigo", "amber", "violet", "emerald", "rose"] as const;

function PublishedList() {
  const t = useT();
  const reports = useReports();
  const loading = reports.isPending || reports.isFetching;
  // Only published reports are navigable, including for owners (FR-SYS-161/164).
  const published = (reports.data?.items ?? []).filter((r) => r.published_version);
  return (
    <Page
      name="report-view"
      title={t("nav.reportView")}
      meta={!loading && !reports.error && reports.data ? <span>{t("rpt.viewCount", { n: published.length })}</span> : undefined}
    >
      {loading ? (
        <section className="pc-panel pc-report-status" role="status" aria-busy="true">
          <span>{t("rpc.loading")}</span>
          <Skeleton active title={false} paragraph={{ rows: 3 }} />
        </section>
      ) : reports.error ? (
        <Alert
          role="alert"
          type="error"
          showIcon
          message={t("rpt.listLoadFailed")}
          description={errorMessage(reports.error, t)}
          action={<Button onClick={() => void reports.refetch()}>{t("common.retry")}</Button>}
        />
      ) : published.length === 0 ? (
        <section className="pc-panel pc-report-status">
          <Empty description={t("rpt.emptyView")} />
        </section>
      ) : (
        <ul className="pc-report-cards" aria-label={t("nav.reportView")}>
          {published.map((r, i) => (
            <li key={r.id}>
              <Link className={`pc-report-card pc-report-card--${TONES[i % TONES.length]}`} to={`/report-view/${r.id}`}>
                <span className="pc-report-card__chip" aria-hidden="true">
                  <Icon name="chart" />
                </span>
                <span className="pc-report-card__body">
                  <strong className="pc-report-card__name" title={r.name}>{r.name}</strong>
                  <span className="pc-report-card__meta">
                    <span className="pc-report-card__version" title={t("rpt.col.version")}>{t("rpt.version", { n: r.published_version! })}</span>
                    {r.published_at && (
                      <time dateTime={r.published_at}>
                        {t("rpt.publishedAt", { at: formatBangkokDateTime(r.published_at) })}
                      </time>
                    )}
                  </span>
                </span>
                <span className="pc-report-card__open">
                  {t("rpt.viewCardHint")}
                  <Icon name="arrow" />
                </span>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Page>
  );
}

/** FR-SYS-159/160/161: the existing published list opens read-only /report-view/:id. */
export function ReportBrowserPage() {
  return (
    <ReportGate need="view">
      <PublishedList />
    </ReportGate>
  );
}
