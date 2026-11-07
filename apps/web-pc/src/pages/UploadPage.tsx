import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Progress, Space, Table, Typography, Upload } from "antd";
import { useEffect, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { Page } from "../components/Page";
import { formatBangkokDateTime } from "../format";
import { isMessageKey, useT } from "../i18n";
import { cancelJob, createJob, deleteFile, type JobOut, listJobs, listPending, rerunJob } from "../ocr/api";
import { StageTag } from "../ocr/StageTag";
import { formatSize, type UploadItem, useUploadQueue } from "../ocr/uploadQueue";
import { ApiError, errorMessage } from "../services/errors";
import { can } from "../tenants/permissions";
import { useTenant } from "../tenants/useTenant";

const UNFINISHED = ["OCR_PROCESSING", "TEMPLATE_MATCHING"];

function failureText(code: string | null | undefined, t: ReturnType<typeof useT>): string {
  const key = `ocrerr.${code ?? ""}`;
  return isMessageKey(key) ? t(key) : t("ocrerr.unknown");
}

/** The upload page (FR-SYS-127, 128), started afresh for each tenant: a switch stops the
 * running upload and forgets the queue, selection and status of the old tenant. */
export function UploadPage() {
  const { tenant } = useTenant();
  return <UploadContent key={tenant?.tenant_id ?? "none"} />;
}

/** Recognising, matching and failed jobs, newest first (at most 20), and the jobs that
 * left the unfinished stages without failing since the page opened (FR-SYS-128). */
function useRecognition() {
  const { tenant } = useTenant();
  const unfinishedBefore = useRef(new Set<string>());
  const finished = useRef<{ id: string; name: string }[]>([]);
  return useQuery({
    queryKey: ["recognition", tenant?.tenant_id],
    enabled: tenant !== null,
    queryFn: async () => {
      const lists = await Promise.all(
        [...UNFINISHED, "OCR_FAILED"].map((stage) => listJobs({ page: 1, pageSize: 20, stage })),
      );
      const rows = lists
        .flatMap((l) => l.items)
        .sort((a, b) => b.created_at.localeCompare(a.created_at))
        .slice(0, 20);
      const unfinished = new Set(rows.filter((j) => UNFINISHED.includes(j.stage)).map((j) => j.id));
      const failed = new Set(rows.filter((j) => j.stage === "OCR_FAILED").map((j) => j.id));
      const names = new Map(lists.flatMap((l) => l.items).map((j) => [j.id, j.file_name]));
      for (const id of unfinishedBefore.current) {
        if (!unfinished.has(id) && !failed.has(id) && !finished.current.some((f) => f.id === id)) {
          finished.current = [...finished.current, { id, name: names.get(id) ?? "" }];
        }
      }
      unfinishedBefore.current = unfinished;
      return { rows, finished: finished.current, running: unfinished.size > 0 };
    },
    refetchInterval: (q) => (q.state.data?.running ? 3000 : false),
  });
}

/** The upload page (FR-SYS-127, 128): drop or choose files into the upload queue; the
 * pending originals with multi-select start or delete; and the recognition status. */
function UploadContent() {
  const t = useT();
  const { message, modal } = App.useApp();
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const [params] = useSearchParams();
  const focus = params.get("job");
  const allowed = can(tenant, "upload_ocr");
  const pending = useQuery({
    queryKey: ["pending", tenant?.tenant_id],
    queryFn: listPending,
    enabled: tenant !== null && allowed,
  });
  const queue = useUploadQueue(() => void queryClient.invalidateQueries({ queryKey: ["pending"] }));
  const recognition = useRecognition();
  const [selected, setSelected] = useState<string[]>([]);
  const [starting, setStarting] = useState(false);
  const [startError, setStartError] = useState<unknown>(null);

  useEffect(() => {
    if (!focus) return;
    document.querySelector(`[data-row-key="${focus}"]`)?.scrollIntoView?.({ block: "center" });
  }, [focus, recognition.data]);

  if (!allowed) {
    return (
      <Page name="upload" title={t("nav.upload")}>
        <Typography.Text>{t("ocr.noUploadPermission")}</Typography.Text>
      </Page>
    );
  }

  const files = pending.data ?? [];
  const chosen = selected.filter((id) => files.some((f) => f.id === id));

  async function start() {
    setStarting(true);
    setStartError(null);
    try {
      for (const id of chosen) {
        await createJob(id, `pc-${id}`);
      }
    } catch (e) {
      setStartError(e);
    } finally {
      setSelected([]);
      setStarting(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["pending"] }),
        queryClient.invalidateQueries({ queryKey: ["recognition"] }),
        queryClient.invalidateQueries({ queryKey: ["jobs"] }),
      ]);
    }
  }

  function removeSelected() {
    modal.confirm({
      title: t("ocr.deleteSelectedConfirm", { n: chosen.length }),
      okText: t("common.confirm"),
      cancelText: t("common.cancel"),
      onOk: async () => {
        for (const id of chosen) await deleteFile(id).catch(() => undefined);
        setSelected([]);
        await queryClient.invalidateQueries({ queryKey: ["pending"] });
      },
    });
  }

  function confirmCancelJob(j: JobOut) {
    modal.confirm({
      title: t("ocr.cancelJobConfirm"),
      okText: t("common.confirm"),
      cancelText: t("common.cancel"),
      onOk: async () => {
        try {
          await cancelJob(j.id);
        } catch (e) {
          void message.error(errorMessage(e, t));
        }
        await queryClient.invalidateQueries({ queryKey: ["recognition"] });
      },
    });
  }

  async function rerun(j: JobOut) {
    try {
      await rerunJob(j.id);
    } catch (e) {
      void message.error(errorMessage(e, t));
    }
    await queryClient.invalidateQueries({ queryKey: ["recognition"] });
  }

  const quota = startError instanceof ApiError && startError.code === "quota_exceeded";
  const expired = startError instanceof ApiError && startError.code === "plan_expired";
  const available = quota ? Number((startError as ApiError).details?.available ?? 0) : 0;

  return (
    <Page name="upload" title={t("nav.upload")}>
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        <Upload.Dragger
          multiple
          showUploadList={false}
          beforeUpload={(file, list) => {
            if (file === list[list.length - 1]) {
              if (queue.busy) void message.warning(t("ocr.queueBusy"));
              else queue.start(list as unknown as File[]);
            }
            return false;
          }}
        >
          <Typography.Title level={5}>{t("ocr.dropTitle")}</Typography.Title>
          <Typography.Text type="secondary">{t("ocr.dropHint")}</Typography.Text>
        </Upload.Dragger>

        {queue.items.length > 0 && (
          <Card
            size="small"
            title={t("ocr.queue")}
            extra={
              queue.busy ? (
                <Button
                  danger
                  size="small"
                  onClick={() =>
                    modal.confirm({
                      title: t("ocr.cancelAllConfirm"),
                      okText: t("common.confirm"),
                      cancelText: t("common.cancel"),
                      onOk: () => queue.cancelAll(),
                    })
                  }
                >
                  {t("ocr.cancelAll")}
                </Button>
              ) : (
                <Button size="small" onClick={() => queue.clearFinished()}>
                  {t("ocr.clearFinished")}
                </Button>
              )
            }
          >
            <Table<UploadItem>
              data-testid="upload-queue"
              size="small"
              pagination={false}
              rowKey="key"
              dataSource={queue.items}
              columns={[
                { key: "name", title: t("review.col.file"), render: (_, i) => i.name },
                { key: "size", title: t("ocr.size"), render: (_, i) => formatSize(i.size) },
                {
                  key: "status",
                  title: t("ocr.status"),
                  render: (_, i) =>
                    i.status === "failed" ? (
                      <Typography.Text type="danger">{errorMessage(i.error, t)}</Typography.Text>
                    ) : i.status === "cancelled" ? (
                      <Typography.Text type="secondary">{t("ocr.cancelled")}</Typography.Text>
                    ) : i.status === "uploaded" ? (
                      t("ocr.uploaded")
                    ) : (
                      <Progress percent={i.percent} size="small" status="active" />
                    ),
                },
                {
                  key: "act",
                  title: "",
                  render: (_, i) =>
                    i.status === "waiting" || i.status === "uploading" ? (
                      <Button size="small" onClick={() => queue.cancel(i.key)}>
                        {t("ocr.cancel")}
                      </Button>
                    ) : i.status === "failed" && i.retryable ? (
                      <Button size="small" onClick={() => queue.retry(i.key)}>
                        {t("common.retry")}
                      </Button>
                    ) : null,
                },
              ]}
            />
          </Card>
        )}

        <Card
          size="small"
          title={t("ocr.pending")}
          extra={
            <Space>
              <Button danger disabled={!chosen.length} onClick={removeSelected}>
                {t("ocr.deleteSelected")}
              </Button>
              <Button type="primary" disabled={!chosen.length} loading={starting} onClick={() => void start()}>
                {t("ocr.startRecognition", { n: chosen.length })}
              </Button>
            </Space>
          }
        >
          {quota && <Alert type="error" showIcon message={t("ocr.quotaLeft", { n: available })} />}
          {expired && (
            <Alert
              type="error"
              showIcon
              message={t("err.plan_expired")}
              action={<Link to="/plans">{t("nav.plans")}</Link>}
            />
          )}
          {Boolean(startError) && !quota && !expired && (
            <Alert type="error" showIcon message={errorMessage(startError, t)} />
          )}
          <Table
            data-testid="pending-list"
            size="small"
            rowKey="id"
            loading={pending.isPending}
            pagination={false}
            locale={{ emptyText: t("ocr.noPending") }}
            dataSource={files}
            rowSelection={{ selectedRowKeys: chosen, onChange: (keys) => setSelected(keys as string[]) }}
            columns={[
              { key: "name", title: t("review.col.file"), render: (_, f) => f.original_name },
              { key: "pages", title: t("review.col.pages"), render: (_, f) => f.page_count ?? "-" },
              { key: "at", title: t("ocr.uploadedAt"), render: (_, f) => formatBangkokDateTime(f.created_at) },
            ]}
          />
        </Card>

        <Card size="small" title={t("ocr.recognitionStatus")}>
          {(recognition.data?.finished ?? []).map((f) => (
            <Alert
              key={f.id}
              type="success"
              showIcon
              style={{ marginBottom: 8 }}
              message={t("ocr.finished", { name: f.name })}
              action={<Link to={`/verify/${f.id}`}>{t("ocr.goVerify")}</Link>}
            />
          ))}
          <Table<JobOut>
            data-testid="recognition-status"
            size="small"
            rowKey="id"
            loading={recognition.isPending}
            pagination={false}
            locale={{ emptyText: t("ocr.noRecognition") }}
            dataSource={recognition.data?.rows ?? []}
            rowClassName={(j) => (j.id === focus ? "ant-table-row-selected" : "")}
            columns={[
              { key: "name", title: t("review.col.file"), render: (_, j) => j.file_name },
              { key: "stage", title: t("ocr.status"), render: (_, j) => <StageTag stage={j.stage} /> },
              {
                key: "detail",
                title: "",
                render: (_, j) =>
                  j.stage === "OCR_FAILED" ? (
                    <Space>
                      <Typography.Text type="danger">{failureText(j.error_code, t)}</Typography.Text>
                      <Button size="small" onClick={() => void rerun(j)}>
                        {t("ocr.rerun")}
                      </Button>
                    </Space>
                  ) : (
                    <Button size="small" onClick={() => confirmCancelJob(j)}>
                      {t("ocr.cancel")}
                    </Button>
                  ),
              },
            ]}
          />
        </Card>
      </Space>
    </Page>
  );
}
