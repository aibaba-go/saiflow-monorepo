import { Alert, Button, Input, Modal, Radio, Space, Table, Typography } from "antd";
import { useRef, useState } from "react";

import { FileName } from "../components/FileName";
import { formatBangkokDateTime } from "../format";
import { useT } from "../i18n";
import { useJobs } from "../ocr/api";
import { MAX_BYTES } from "../ocr/upload";
import { ApiError, errorMessage } from "../services/errors";
import { can } from "../tenants/permissions";
import { useTenant } from "../tenants/useTenant";
import { sampleFromJob, uploadSample, type Sample } from "./api";

const TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "application/pdf"]);
const DONE = new Set(["SUCCEEDED", "PARTIAL_SUCCESS"]);

/** A rejection known before the upload, as the backend's code; the backend still sniffs. */
function localCheck(file: File): string | null {
  const mime = (file.type || "").toLowerCase();
  const typed = mime && mime !== "application/octet-stream";
  if (typed ? !TYPES.has(mime) : !/\.(jpe?g|png|pdf)$/i.test(file.name)) return "sample_file_type";
  if (file.size > MAX_BYTES) return "sample_file_too_large";
  return null;
}

/** "Generate from sample" (FR-TEMPLATE-008/014): upload a new sample (template_manage and
 * upload_ocr) or reuse a finished recognition result the user can see; the scan charge
 * is said before anything starts. */
export function SampleDialog({ open, onClose, onStarted }: { open: boolean; onClose: () => void; onStarted: (s: Sample) => void }) {
  const t = useT();
  const { tenant } = useTenant();
  const mayUpload = can(tenant, "upload_ocr");
  const [mode, setMode] = useState<"upload" | "job">(mayUpload ? "upload" : "job");
  const [file, setFile] = useState<File | null>(null);
  const [jobId, setJobId] = useState<string | null>(null);
  const [q, setQ] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const jobs = useJobs({ page: 1, pageSize: 20, ...(q ? { q } : {}) });
  const done = (jobs.data?.items ?? []).filter((j) => DONE.has(j.status) && !["OCR_PROCESSING", "OCR_FAILED"].includes(j.stage));

  async function start() {
    setError(null);
    if (mode === "upload") {
      if (!file) return;
      const local = localCheck(file);
      if (local) return setError(new ApiError(400, local, ["file"]));
    } else if (!jobId) return;
    setBusy(true);
    try {
      const sample = mode === "upload" ? await uploadSample(file!) : await sampleFromJob(jobId!);
      onStarted(sample);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const quota = error instanceof ApiError && error.code === "quota_exceeded";
  return (
    <Modal
      open={open}
      title={t("sample.title")}
      onCancel={onClose}
      width={720}
      destroyOnHidden
      footer={[
        <Button key="cancel" onClick={onClose}>
          {t("common.cancel")}
        </Button>,
        <Button
          key="start"
          type="primary"
          loading={busy}
          disabled={mode === "upload" ? !file || !mayUpload : !jobId}
          onClick={() => void start()}
        >
          {t("sample.start")}
        </Button>,
      ]}
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Radio.Group value={mode} onChange={(e) => setMode(e.target.value as "upload" | "job")}>
          <Radio value="upload">{t("sample.upload")}</Radio>
          <Radio value="job">{t("sample.fromJob")}</Radio>
        </Radio.Group>
        {mode === "upload" &&
          (mayUpload ? (
            <div>
              <input
                ref={input}
                type="file"
                accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                aria-label={t("sample.choose")}
                style={{ display: "none" }}
                onChange={(e) => {
                  setFile(e.target.files?.[0] ?? null);
                  setError(null);
                }}
              />
              <Space>
                <Button onClick={() => input.current?.click()}>{t("sample.choose")}</Button>
                {file && <FileName name={file.name} />}
              </Space>
              <Typography.Paragraph type="secondary" style={{ marginTop: 8 }}>
                {t("sample.uploadHint")}
              </Typography.Paragraph>
            </div>
          ) : (
            <Alert type="info" showIcon message={t("sample.noUpload")} />
          ))}
        {mode === "job" && (
          <div>
            <Input.Search
              aria-label={t("sample.searchJobs")}
              placeholder={t("sample.searchJobs")}
              allowClear
              onSearch={(v) => setQ(v.trim())}
              style={{ marginBottom: 8 }}
            />
            <Table
              size="small"
              rowKey="id"
              loading={jobs.isPending}
              dataSource={done}
              pagination={false}
              locale={{ emptyText: t("sample.noJobs") }}
              rowSelection={{ type: "radio", selectedRowKeys: jobId ? [jobId] : [], onChange: (keys) => setJobId(String(keys[0] ?? "")) }}
              onRow={(row) => ({ onClick: () => setJobId(row.id) })}
              columns={[
                { key: "file", title: t("table.file"), render: (_, j) => <FileName name={j.file_name} /> },
                { key: "tpl", title: t("library.template"), render: (_, j) => j.template_name ?? "—" },
                { key: "at", title: t("table.created"), render: (_, j) => formatBangkokDateTime(j.created_at) },
              ]}
            />
          </div>
        )}
        <Alert type="warning" showIcon message={t("sample.chargeNote")} />
        {error !== null && (
          <Alert
            role="alert"
            type="error"
            showIcon
            message={quota ? t("ocr.quotaLeft", { n: Number((error as ApiError).details?.available ?? 0) }) : errorMessage(error, t)}
          />
        )}
      </Space>
    </Modal>
  );
}
