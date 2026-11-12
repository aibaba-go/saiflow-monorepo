import { Empty, Spin, Typography } from "antd";
import { Link } from "react-router-dom";

import { ErrorText } from "../components/ErrorText";
import { Page } from "../components/Page";
import { formatBangkokDateTime } from "../format";
import { useT } from "../i18n";
import { Icon } from "../layout/icons";
import { useReports } from "../reports/api";
import { ReportGate } from "../reports/common";

/** The tones the cards cycle through, so neighbouring reports are told apart at a glance. */
const TONES = ["teal", "indigo", "amber", "violet", "emerald", "rose"] as const;

function PublishedList() {
  const t = useT();
  const reports = useReports();
  // a viewer only gets published reports; drafts never show here, even for a designer
  const published = (reports.data?.items ?? []).filter((r) => r.published_version);
  return (
    <Page
      name="report-view"
      title={t("nav.reportView")}
      meta={reports.data ? <span>{t("rpt.viewCount", { n: published.length })}</span> : undefined}
    >
      <ErrorText error={reports.error} />
      {reports.isPending ? (
        <Spin />
      ) : published.length === 0 ? (
        <section className="pc-panel">
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
                  <strong className="pc-report-card__name">{r.name}</strong>
                  <span className="pc-report-card__meta">
                    <span className="pc-report-card__version">{t("rpt.version", { n: r.published_version! })}</span>
                    {r.published_at && (
                      <Typography.Text type="secondary">
                        {t("rpt.publishedAt", { at: formatBangkokDateTime(r.published_at) })}
                      </Typography.Text>
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

/** "View reports" (FR-SYS-159, FR-SYS-160): the published reports of the current
 * organization as cards; each opens the read-only page at /report-view/:id. */
export function ReportBrowserPage() {
  return (
    <ReportGate need="view">
      <PublishedList />
    </ReportGate>
  );
}
