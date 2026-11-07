import { App, Button, Card, Col, Descriptions, Row, Space, Spin } from "antd";
import { useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";

import { useMe } from "../auth/session";
import { ErrorText } from "../components/ErrorText";
import { Page } from "../components/Page";
import { formatBangkokDateTime } from "../format";
import { useT } from "../i18n";
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

  return (
    <Page
      name="document"
      title={j.file_name}
      extra={
        <Space>
          {canVerify && (
            <Button type="primary" onClick={() => navigate(`/verify/${j.id}`)}>
              {t("ocr.goVerify")}
            </Button>
          )}
          {canExport && (
            <Button type="primary" loading={exporting} onClick={() => void doExport()}>
              {t("library.exportExcel")}
            </Button>
          )}
        </Space>
      }
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Descriptions size="small" bordered column={4}>
          <Descriptions.Item label={t("ocr.status")}>
            <StageTag stage={j.stage} level={j.review_level} />
          </Descriptions.Item>
          <Descriptions.Item label={t("review.col.template")}>{data.template?.name ?? t("review.generic")}</Descriptions.Item>
          <Descriptions.Item label={t("library.createdAt")}>{formatBangkokDateTime(j.created_at)}</Descriptions.Item>
          <Descriptions.Item label={t("review.col.confirmedAt")}>
            {j.confirmed_at ? formatBangkokDateTime(j.confirmed_at) : "-"}
          </Descriptions.Item>
        </Descriptions>
        <Row gutter={16}>
          <Col span={10}>
            <Card size="small" title={t("review.original")}>
              <OriginalPages fileId={j.file_id} fileName={j.file_name} pageCount={j.page_count} />
            </Card>
          </Col>
          <Col span={14}>
            <Card size="small" title={t("library.result")}>
              <ReadonlyResult value={data.structured} groups={groups} lang={lang} t={t} />
            </Card>
          </Col>
        </Row>
        <Card size="small" title={t("review.records")}>
          <ReviewRecordList records={data.review.records} t={t} />
        </Card>
        <Card size="small" title={t("review.changes")}>
          <ChangeLogTable entries={changes.data ?? []} groups={groups} t={t} lang={lang} />
        </Card>
      </Space>
    </Page>
  );
}
