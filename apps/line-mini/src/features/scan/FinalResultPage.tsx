import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { BrandLoading } from "../../components/BrandLoading";
import { useT } from "../../i18n";
import { errorMessage } from "../../services/errors";
import { useLanguage } from "../../stores/language";
import { formatBangkokDateTime } from "../../utils/format";
import { authLiff } from "../auth/session";
import { can } from "../tenants/permissions";
import { useCurrentTenant } from "../tenants/useCurrentTenant";
import { ReviewRecords } from "../reviews/ReviewRecords";
import { ChangeLog } from "./components/ChangeLog";
import { OriginalPreview } from "./components/OriginalPreview";
import { PageHeader } from "./components/PageHeader";
import { StatusChip } from "./components/StatusChip";
import { StructuredDataView } from "./components/StructuredDataView";
import { exportAndDownload, type XlsxOutcome } from "./download";
import s from "./FinalResultPage.module.css";
import { useJob } from "./ProcessingPage";
import { useResult } from "./ResultPage";
import type { Group, Json } from "./structured";
import theme from "./theme.module.css";

/** The working 20261104 server-link export flow (FR-SYS-107, 116): read-only
 * confirmed result with its original, permission-gated Excel download and New scan.
 * iOS LINE follows the attachment URL; Android LINE uses the phone browser. */
export function FinalResultPage() {
  const t = useT();
  const navigate = useNavigate();
  const lang = useLanguage((st) => st.lang);
  const { tenant } = useCurrentTenant();
  const { id = "" } = useParams();
  const location = useLocation();
  const [toast, setToast] = useState<boolean>(Boolean((location.state as { submitted?: boolean } | null)?.submitted));
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(false), 2500);
    return () => clearTimeout(timer);
  }, [toast]);
  const job = useJob(id, false);
  const result = useResult(id);
  const exportRequest = useRef<AbortController | null>(null);
  const data = result.data;
  const confirmed = job.data?.stage === "CONFIRMED";
  const pages = job.data?.page_count || 1;
  const tenantId = tenant?.tenant_id;
  const eligible = can(tenant, "export") && confirmed;
  const exportKey = JSON.stringify([id, tenantId, lang, eligible]);
  const [exportState, setExportState] = useState<{
    key: string; loading: boolean; how: XlsxOutcome["how"] | null; error: unknown;
  }>({ key: "", loading: false, how: null, error: null });
  // Old status is never displayed under a new task, tenant, language or permission.
  const exporting = exportState.key === exportKey && exportState.loading;
  const saved = exportState.key === exportKey ? exportState.how : null;
  const error = exportState.key === exportKey ? exportState.error : null;

  useLayoutEffect(() => () => {
    exportRequest.current?.abort();
    exportRequest.current = null;
  }, [exportKey]);

  async function exportExcel() {
    if (exportRequest.current || !eligible) return;
    const controller = new AbortController();
    exportRequest.current = controller;
    setExportState({ key: exportKey, loading: true, how: null, error: null });
    try {
      const outcome = await exportAndDownload(id, lang, authLiff(), job.data?.file_name ?? "result", controller.signal);
      if (!controller.signal.aborted) setExportState({ key: exportKey, loading: false, how: outcome.how, error: null });
    } catch (e) {
      if (!controller.signal.aborted) setExportState({ key: exportKey, loading: false, how: null, error: e });
    } finally {
      if (exportRequest.current === controller) exportRequest.current = null;
    }
  }

  return (
    <div className={`${theme.scan} ${s.final}`}>
      <PageHeader title={t("final.title")} onBack={() => navigate("/history")} />
      {result.isError && !data ? (
        <div className={s.fatal}>
          <p className={s["status-error"]}>{errorMessage(result.error, t)}</p>
          <button type="button" className={s["home-btn"]} onClick={() => navigate("/history")}>
            {t("common.back")}
          </button>
        </div>
      ) : data ? (
        <>
          {/* prototype .final-hero: the outcome in one line */}
          <div className={s.hero}>
            <span className={`${s["hero-mark"]} ${confirmed ? "" : s["hero-mark--review"]}`} aria-hidden>
              {confirmed ? (
                <svg width="30" height="30" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              ) : (
                <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="9" />
                  <path d="M12 7v5l3 2" />
                </svg>
              )}
            </span>
            <h2 className={s["hero-title"]}>{t(confirmed ? "final.confirmedTitle" : "final.reviewTitle")}</h2>
            <p className={s["hero-sub"]}>
              {confirmed
                ? t("final.confirmedSub")
                : data.review && data.review.stage !== "NONE"
                  ? t(data.review.stage === "PENDING_L2" ? "review.pending2" : "review.pending1")
                  : t("final.reviewSub")}
            </p>
          </div>
          {/* prototype .summary: the file and its facts, every value from the job */}
          <div className={s.summary}>
            <div className={s["summary-head"]}>
              <span className={s["summary-name"]}>{job.data?.file_name ?? ""}</span>
              {job.data && <StatusChip stage={job.data.stage} level={job.data.review_level} returned={job.data.returned} />}
            </div>
            <dl className={s.facts}>
              <div className={s.fact}>
                <dt>{t("template.label")}</dt>
                <dd>{data.template?.name ?? t("template.generic")}</dd>
              </div>
              <div className={s.fact}>
                <dt>{t("final.pages")}</dt>
                <dd className="num">{pages}</dd>
              </div>
              {job.data?.created_at && (
                <div className={s.fact}>
                  <dt>{t("final.createdAt")}</dt>
                  <dd className="num">{formatBangkokDateTime(job.data.created_at)}</dd>
                </div>
              )}
              {job.data?.confirmed_at && (
                <div className={s.fact}>
                  <dt>{t("final.confirmedAt")}</dt>
                  <dd className="num">{formatBangkokDateTime(job.data.confirmed_at)}</dd>
                </div>
              )}
            </dl>
          </div>
          <div className={s.content}>
            {job.data && (
              <section className={s.section} aria-label={t("final.originalSection")}>
                <div className={s["section-head"]}>
                  <h3 className={s["section-title"]}>{t("final.originalSection")}</h3>
                  <span className={s["section-meta"]}>
                    {pages === 1 ? t("home.pending.pageOne") : t("home.pending.pageMany", { n: pages })}
                  </span>
                </div>
                <OriginalPreview fileId={job.data.file_id} fileName={job.data.file_name} pageCount={pages} />
              </section>
            )}
            <StructuredDataView
              value={(data.structured ?? {}) as Json}
              groups={(data.template?.groups ?? null) as Group[] | null}
              missing={new Set()}
              warnings={new Set()}
              amountIssues={new Map()}
              editable={false}
              onChange={() => {}}
            />
            <ReviewRecords records={data.review?.records ?? []} />
            <ChangeLog jobId={id} groups={(data.template?.groups ?? null) as Group[] | null} variant="link" />
            {Boolean(error) && (
              <p className={s["status-error"]} role="alert">
                {errorMessage(error, t)}
              </p>
            )}
            {saved && <p className={s["export-ready"]} role="status">{t(saved === "external" ? "final.exportExternal" : "final.exportReady")}</p>}
          </div>
          <div className={s["action-bar"]}>
            <button type="button" className={s["secondary-btn"]} onClick={() => navigate("/")}>
              {t("final.newScan")}
            </button>
            {can(tenant, "export") && job.data?.stage === "CONFIRMED" && (
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
          </div>
        </>
      ) : (
        <div className={s.fatal}>
          <BrandLoading variant="inline" label={t("common.loading")} />
        </div>
      )}
      {toast && (
        <div className={s["export-ready"]} role="status">
          {t("review.submitted")}
        </div>
      )}
    </div>
  );
}
