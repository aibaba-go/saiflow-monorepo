import { ChartColumn, ChevronRight } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { BrandLoading } from "../../components/BrandLoading";
import { Button } from "../../components/ui/button";
import { EmptyState } from "../../components/ui/empty-state";
import { useT } from "../../i18n";
import { errorMessage } from "../../services/errors";
import { formatBangkokDateTime } from "../../utils/format";
import kit from "../scan/kit.module.css";
import theme from "../scan/theme.module.css";
import { useCurrentTenant } from "../tenants/useCurrentTenant";
import { useReports } from "./api";
import s from "./reports.module.css";

/** The Report tab (FR-SYS-056): the published reports of the current organization the user
 * may view, newest change first. Loading, empty and failed are told apart; LINE has no
 * designer, so drafts and design actions never show. */
export function ReportListPage() {
  const t = useT();
  const navigate = useNavigate();
  const { tenant } = useCurrentTenant();
  const reports = useReports();
  const workspace = tenant?.kind === "organization" ? tenant.name || t("my.company") : t("home.workspacePersonal");
  return (
    <div className={`${theme.scan} ${s.page}`}>
      <header className={kit["tab-top"]}>
        <span className={kit["tab-eyebrow"]} aria-hidden="true">SAIFLOW</span>
        <h1 className={kit["tab-title"]}>{t("nav.report")}</h1>
        <span className={kit["tab-end"]} />
      </header>
      <div className={s.content}>
        <div className={kit["title-block"]}>
          <span className={kit.eyebrow}>{t("rpt.eyebrow")}</span>
          <h2>{t("rpt.tagline")}</h2>
          <p>{t("rpt.lineScope", { workspace })}</p>
        </div>
        {reports.isPending ? (
          <BrandLoading variant="inline" label={t("common.loading")} />
        ) : reports.isError ? (
          <EmptyState status="error" title={t("rpt.loadFailed")} description={errorMessage(reports.error, t)}>
            <Button variant="primary" loading={reports.isFetching} onClick={() => void reports.refetch()}>
              {t("common.retry")}
            </Button>
          </EmptyState>
        ) : reports.data.length === 0 ? (
          <EmptyState status="empty" title={t("rpt.emptyView")} />
        ) : (
          <ul className={s.list} aria-label={t("rpt.listLabel")}>
            {reports.data.map((r) => (
              <li key={r.id}>
                <button type="button" className={s.item} onClick={() => navigate(`/report/${r.id}`)}>
                  <span className={s["item-icon"]} aria-hidden="true">
                    <ChartColumn size={18} strokeWidth={1.75} />
                  </span>
                  <span className={s["item-body"]}>
                    <span className={s["item-name"]}>{r.name}</span>
                    {r.published_version !== null && r.published_at && (
                      <span className={s.meta}>
                        {t("rpt.publishedMeta", { n: r.published_version, at: formatBangkokDateTime(r.published_at) })}
                      </span>
                    )}
                  </span>
                  <ChevronRight className={s.chevron} size={18} strokeWidth={1.75} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
