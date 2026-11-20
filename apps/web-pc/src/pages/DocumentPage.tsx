import { App, Button, Descriptions, Space, Spin } from "antd";
import { useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";

import { useMe } from "../auth/session";
import { ErrorText } from "../components/ErrorText";
import { Page } from "../components/Page";
import { formatBangkokDateTime } from "../format";
import { isMessageKey, useT } from "../i18n";
import { Icon } from "../layout/icons";
import { useJob, useResult } from "../ocr/api";
import { exportAndDownload } from "../ocr/download";
import { canEditJob } from "../ocr/stage";
import { StageTag } from "../ocr/StageTag";
import { useChanges } from "../reviews/api";
import { ChangeLogTable } from "../reviews/ChangeLogTable";
import { OriginalPages } from "../reviews/OriginalPages";
import { ReadonlyResult, type Group } from "../reviews/ReadonlyResult";
import { ReviewRecordList } from "../reviews/ReviewRecordList";
import { errorMessage } from "../services/errors";
import { useLanguage } from "../stores/language";
import { can } from "../tenants/permissions";
import { useTenant } from "../tenants/useTenant";

/** Document detail (FR-SYS-131): the original and the result read-only, review history and
 * change log; "Export Excel" once official (with the export permission); "Go to verify"
 * while to verify (with a verify permission). */
export function DocumentPage() {
  const t = useT();
  const lang = useLanguage((s) => s.lang);
  const navigate = useNavigate();
  const { message } = App.useApp();
  const { tenant } = useTenant();
  const me = useMe();
  const { id = "" } = useParams();
  const job = useJob(id);
  const unfinished = Boolean(job.data && ["OCR_PROCESSING", "TEMPLATE_MATCHING", "OCR_FAILED"].includes(job.data.stage));
  const result = useResult(id, job.isSuccess && !unfinished);
  const changes = useChanges(id, job.isSuccess);
  const [exporting, setExporting] = useState(false);

  if (job.isError) {
    return (
      <Page name="document" title={t("nav.library")}>
        <ErrorText error={job.error} />
      </Page>
    );
  }
  // still recognising or failed: its place is the recognition status (minor-fixes-ui)
  if (unfinished) return <Navigate to={`/upload?job=${id}`} replace />;
  if (!job.data || !result.data) return result.isError ? <ErrorText error={result.error} /> : <Spin />;
  const j = job.data;
  const data = result.data;
  const groups = (data.template?.groups ?? null) as Group[] | null;
  const canExport = j.stage === "CONFIRMED" && can(tenant, "export");
  const canVerify = j.stage === "VERIFYING" && canEditJob(j, tenant, me.data?.user_id);

  async function doExport() {
    setExporting(true);
    try {
      await exportAndDownload(j.id, lang, j.file_name);
    } catch (e) {
      void message.error(errorMessage(e, t));
    } finally {
      setExporting(false);
    }
  }

  const descKey = `document.desc.${j.stage}`;
  const review = j.stage === "PENDING_REVIEW";
  const confirmed = j.stage === "CONFIRMED";
  return (
    <Page
      name="document"
      title={t("layout.documentDetail")}
      badge={<StageTag stage={j.stage} level={j.review_level} />}
      description={isMessageKey(descKey) ? t(descKey) : t("layout.desc.document")}
      extra={
        <Space>
          <Button icon={<Icon name="back" />} onClick={() => navigate("/library")}>
            {t("detail.back")}
          </Button>
          {canVerify && (
            <Button type="primary" onClick={() => navigate(`/verify/${j.id}`)}>
              {t("ocr.goVerify")}
            </Button>
          )}
        </Space>
      }
    >
      <div className="pc-document">
        <div className="pc-sticky-original">
          <OriginalPages fileId={j.file_id} fileName={j.file_name} pageCount={j.page_count} />
        </div>
        <section className="pc-editor">
          <div className="pc-editor__top">
            <strong>{t("editor.current")}</strong>
            <span className="pc-ai-label">
              <Icon name="spark" />
              {t(confirmed ? "editor.aiConfirmed" : review ? "editor.aiReview" : "editor.aiPending")}
            </span>
          </div>
          <div className="pc-editor__body">
            <div className="pc-editor__template">
              <span>
                {t("table.template")} <strong>{data.template?.name ?? t("review.generic")}</strong>
              </span>
              <span className="pc-editor__readonly">
                <Icon name="lock" />
                {t("editor.readonly")}
              </span>
            </div>
            <Descriptions size="small" column={2} className="pc-document__facts">
              <Descriptions.Item label={t("review.col.file")}>{j.file_name}</Descriptions.Item>
              <Descriptions.Item label={t("library.createdAt")}>{formatBangkokDateTime(j.created_at)}</Descriptions.Item>
              <Descriptions.Item label={t("review.col.confirmedAt")}>
                {j.confirmed_at ? formatBangkokDateTime(j.confirmed_at) : "-"}
              </Descriptions.Item>
            </Descriptions>
            <ReadonlyResult value={data.structured} groups={groups} lang={lang} t={t} />
            <p className={`pc-editor__notice${confirmed ? " pc-editor__notice--success" : ""}`}>
              <Icon name={confirmed ? "check" : review ? "lock" : "info"} />
              {t(confirmed ? "editor.noticeConfirmed" : review ? "editor.noticeReview" : "editor.noticeVerifying")}
            </p>
          </div>
          <div className="pc-editor__actions">
            <Button
              type="link"
              className="pc-ghost"
              icon={<Icon name="history" />}
              onClick={() => document.getElementById("pc-change-log")?.scrollIntoView?.({ behavior: "smooth", block: "start" })}
            >
              {t("review.changes")}
            </Button>
            <span className="pc-editor__primary">
              {canExport && (
                <Button type="primary" icon={<Icon name="download" />} loading={exporting} onClick={() => void doExport()}>
                  {t("library.exportExcel")}
                </Button>
              )}
              {review && (
                <span className="pc-editor__waiting">
                  <Icon name="lock" />
                  {t("editor.waitingReview")}
                </span>
              )}
            </span>
          </div>
        </section>
      </div>
      <section className="pc-panel">
        <div className="pc-panel__heading">
          <h2>{t("review.records")}</h2>
        </div>
        <div className="pc-panel__body">
          <ReviewRecordList records={data.review.records} t={t} />
        </div>
      </section>
      <section className="pc-panel" id="pc-change-log">
        <div className="pc-panel__heading">
          <h2>{t("review.changes")}</h2>
        </div>
        <ChangeLogTable entries={changes.data ?? []} groups={groups} t={t} lang={lang} />
      </section>
    </Page>
  );
}
