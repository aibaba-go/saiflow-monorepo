import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { BrandLoading } from "../../components/BrandLoading";
import { useT } from "../../i18n";
import { errorMessage } from "../../services/errors";
import { useLanguage } from "../../stores/language";
import { authLiff } from "../auth/session";
import { can } from "../tenants/permissions";
import { useCurrentTenant } from "../tenants/useCurrentTenant";
import { OriginalPreview } from "./components/OriginalPreview";
import { PageHeader } from "./components/PageHeader";
import { StatusChip } from "./components/StatusChip";
import { StructuredDataView } from "./components/StructuredDataView";
import { exportAndDownload } from "./download";
import s from "./FinalResultPage.module.css";
import { useJob } from "./ProcessingPage";
import { useResult } from "./ResultPage";
import type { Group, Json } from "./structured";
import theme from "./theme.module.css";

/** main `FinalResultPage.vue` (FR-SYS-107, 116): the confirmed result read-only with its
 * original, "Export Excel" for holders of the export permission (preparing → ready, or the
 * phone browser in LINE), and "New scan". */
export function FinalResultPage() {
  const t = useT();
  const navigate = useNavigate();
  const lang = useLanguage((st) => st.lang);
  const { tenant } = useCurrentTenant();
  const { id = "" } = useParams();
  const job = useJob(id, false);
  const result = useResult(id);
  const [exporting, setExporting] = useState(false);
  const [hint, setHint] = useState<"ready" | "external" | null>(null);
  const [error, setError] = useState<unknown>(null);
  const data = result.data;

  async function exportExcel() {
    setExporting(true);
    setError(null);
    setHint(null);
    try {
      const liff = authLiff();
      await exportAndDownload(id, lang, liff, job.data?.file_name ?? "result");
      setHint(liff.isInClient() ? "external" : "ready");
    } catch (e) {
      setError(e);
    } finally {
      setExporting(false);
    }
  }

  return (
    <div className={`${theme.scan} ${s.final}`}>
      <PageHeader title={job.data?.file_name || t("final.title")} onBack={() => navigate("/history")} />
      {result.isError && !data ? (
        <div className={s.fatal}>
          <p className={s["status-error"]}>{errorMessage(result.error, t)}</p>
          <button type="button" className={s["home-btn"]} onClick={() => navigate("/history")}>
            {t("common.back")}
          </button>
        </div>
      ) : data ? (
        <>
          <div className={s.summary}>
            <div className={s.chips}>{job.data && <StatusChip stage={job.data.stage} />}</div>
            <div className={s.title}>{t("final.title")}</div>
            <div className={s.meta}>
              {(job.data?.page_count ?? 1) === 1
                ? t("home.pending.pageOne")
                : t("home.pending.pageMany", { n: job.data?.page_count ?? 1 })}
            </div>
          </div>
          <div className={s.content}>
            {job.data && (
              <OriginalPreview fileId={job.data.file_id} fileName={job.data.file_name} pageCount={job.data.page_count || 1} />
            )}
            <div className={s.meta}>
              {t("template.label")}: {data.template?.name ?? t("template.generic")}
            </div>
            <StructuredDataView
              value={(data.structured ?? {}) as Json}
              groups={(data.template?.groups ?? null) as Group[] | null}
              missing={new Set()}
              warnings={new Set()}
              amountIssues={new Map()}
              editable={false}
              onChange={() => {}}
            />
            {Boolean(error) && (
              <p className={s["status-error"]} role="alert">
                {errorMessage(error, t)}
              </p>
            )}
            {hint === "ready" && <p className={s["export-ready"]}>{t("final.exportReady")}</p>}
            {hint === "external" && <p className={s["export-ready"]}>{t("final.exportExternal")}</p>}
          </div>
          <div className={s["action-bar"]}>
            {can(tenant, "export") && (
              <button type="button" className={s["primary-btn"]} disabled={exporting} onClick={() => void exportExcel()}>
                {exporting ? (
                  <BrandLoading variant="inline" label={t("final.exporting")} />
                ) : (
                  <>
                    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M12 3v12" />
                      <path d="M7 10l5 5 5-5" />
                      <path d="M4 21h16" />
                    </svg>
                    {t("final.exportExcel")}
                  </>
                )}
              </button>
            )}
            <button type="button" className={s["secondary-btn"]} onClick={() => navigate("/")}>
              {t("final.newScan")}
            </button>
          </div>
        </>
      ) : (
        <div className={s.fatal}>
          <BrandLoading variant="inline" label={t("common.loading")} />
        </div>
      )}
    </div>
  );
}
