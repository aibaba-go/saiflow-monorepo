import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Col, Form, Image, Radio, Result, Row, Space, Spin, Steps, Typography } from "antd";
import {
  TemplateEditor,
  validateTemplateClient,
  type PendingConfirmation,
  type TemplateContent,
  type TemplatePathError,
} from "@saiflow/ui/template-editor";
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { ConfirmButton } from "../components/ConfirmButton";
import { ErrorText } from "../components/ErrorText";
import { Page } from "../components/Page";
import { formatTime } from "../format";
import { useSubmit } from "../hooks/useSubmit";
import { isMessageKey, useT } from "../i18n";
import { ApiError, errorMessage } from "../services/errors";
import {
  pickContent,
  SAMPLE_RUNNING,
  sampleKeys,
  samples,
  templateKeys,
  templates,
  type Owner,
  type Sample,
  type TemplateTarget,
} from "../services/templates";
import {
  ActionError,
  codeErrors,
  GuardedLink,
  remapPaths,
  same,
  saveErrors,
  useEditorLabels,
  useLeaveWarning,
} from "./TemplateEditPage";
import { OwnerSelect, SampleStatusTag, type NewTemplateState } from "./TemplatesPage";

const STEP: Record<Sample["status"], number> = {
  QUEUED: 0,
  OCR_RUNNING: 1,
  GENERATING: 2,
  READY: 3,
  FAILED: 1,
  CANCELED: 0,
};

/** One page of the original as an object URL (a PDF arrives as page images). */
function usePageUrl(sampleId: string, page: number): string | null {
  const blob = useQuery({
    queryKey: sampleKeys.page(sampleId, page),
    queryFn: () => samples.page(sampleId, page),
    staleTime: 5 * 60_000,
  });
  const url = useMemo(
    () => (blob.data && typeof URL.createObjectURL === "function" ? URL.createObjectURL(blob.data) : null),
    [blob.data],
  );
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return url;
}

/** The original page by page, kept in view while the editor scrolls (AC-FR-TEMPLATE-008-01). */
function SamplePages({ sample }: { sample: Sample }) {
  const t = useT();
  const pages = Math.max(sample.pages || 1, 1);
  const [page, setPage] = useState(1);
  const url = usePageUrl(sample.id, page);
  return (
    <div className="ad-sample-original">
      <div className="ad-sample-viewer" aria-label={t("sample.original")}>
        <div className="ad-sample-viewer__head">{t("sample.original")}</div>
        <div className="ad-sample-viewer__paper">
          {url ? <Image src={url} alt={t("sample.original")} width="100%" /> : <Spin />}
        </div>
        <div className="ad-sample-viewer__foot">
          <Button size="small" type="text" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            {t("sample.prevPage")}
          </Button>
          <span>{t("sample.pageOf", { n: page, total: pages })}</span>
          <Button size="small" type="text" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            {t("sample.nextPage")}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** READY: the original beside the generated structure. Nothing exists until "Save as draft"
 * creates the template in the chosen target with the suggestions still to confirm
 * (FR-TEMPLATE-008, FR-SYS-142); the sample stays for another draft until deleted. */
function Candidate({ sample, candidate }: { sample: Sample; candidate: NonNullable<Sample["candidate"]> }) {
  const t = useT();
  const labels = useEditorLabels();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const state = (useLocation().state ?? {}) as NewTemplateState;
  const initial = useMemo(
    () => ({
      content: pickContent(candidate.content),
      pending: candidate.suggestions.map((s): PendingConfirmation => ({ path: s.path, attr: s.attr, value: s.value })),
    }),
    [candidate],
  );
  const [scope, setScope] = useState<"system" | "tenant">(state.scope === "tenant" && state.owner ? "tenant" : "system");
  const [owner, setOwner] = useState<Owner | null>(state.owner ?? null);
  const [content, setContent] = useState<TemplateContent>(initial.content);
  const [pending, setPending] = useState<PendingConfirmation[]>(initial.pending);
  const [serverErrors, setServerErrors] = useState<TemplatePathError[]>([]);
  const [error, setError] = useState<unknown>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const dirty = !same(content, initial.content) || pending.length !== initial.pending.length;
  useLeaveWarning(dirty);
  const errors = useMemo(() => [...validateTemplateClient(content), ...serverErrors], [content, serverErrors]);

  const save = useSubmit(async () => {
    setError(null);
    setProblem(null);
    if (scope === "tenant" && !owner) return setProblem(t("field.tenant_id"));
    const local = codeErrors(content, t);
    if (local.length) return setServerErrors(local);
    const target: TemplateTarget = scope === "system" ? { scope: "system" } : { scope: "tenant", tenantId: owner!.tenant_id };
    try {
      const created = await templates.create(target, content, { sampleId: sample.id, pending });
      queryClient.setQueryData(templateKeys.one(created.id), created);
      await queryClient.invalidateQueries({ queryKey: templateKeys.lists });
      void message.success(t("tpl.created"));
      navigate(`/templates/${created.id}`);
    } catch (e) {
      setError(e);
      setServerErrors(saveErrors(e, t) ?? []);
    }
  });

  return (
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Alert type="info" showIcon message={t("sample.readyNote")} />
      <Card size="small">
        <Form layout="vertical">
          <Form.Item label={t("sample.target")} style={{ marginBottom: scope === "tenant" ? 12 : 0 }}>
            <Radio.Group value={scope} onChange={(e) => setScope(e.target.value as "system" | "tenant")}>
              <Space wrap>
                <Radio value="system">{t("tpl.target.system")}</Radio>
                <Radio value="tenant">{t("tpl.target.tenant")}</Radio>
              </Space>
            </Radio.Group>
          </Form.Item>
          {scope === "tenant" && (
            <Form.Item label={t("tpl.owner")} htmlFor="sample-owner" style={{ marginBottom: 0, maxWidth: 420 }}>
              <OwnerSelect id="sample-owner" value={owner} onChange={setOwner} />
            </Form.Item>
          )}
        </Form>
      </Card>
      {problem && <Alert role="alert" type="error" showIcon message={problem} />}
      <ActionError error={error} />
      <Space>
        <Button type="primary" loading={save.pending} onClick={() => void save.run()}>
          {t("tpl.saveDraft")}
        </Button>
      </Space>
      <Row gutter={16}>
        <Col xs={24} lg={10}>
          <SamplePages sample={sample} />
        </Col>
        <Col xs={24} lg={14}>
          <Card title={t("tpl.editingDraft")}>
            <TemplateEditor
              value={content}
              onChange={(next) => {
                if (next.code !== content.code) setServerErrors((prev) => prev.filter((e) => e.path !== "code"));
                setContent(next);
              }}
              errors={errors}
              sampleValues={candidate.values}
              pendingConfirmations={pending}
              onConfirm={(path, attr) => setPending((list) => list.filter((p) => !(p.path === path && p.attr === attr)))}
              onPathsRemap={(remap) => {
                setPending((list) => remapPaths(list, remap));
                setServerErrors((list) => remapPaths(list, remap));
              }}
              labels={labels}
            />
          </Card>
        </Col>
      </Row>
    </Space>
  );
}

function SampleView({ sample }: { sample: Sample }) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const key = sampleKeys.one(sample.id);
  const running = SAMPLE_RUNNING.includes(sample.status);
  const failed = sample.status === "FAILED";

  const act = useSubmit(async (job: () => Promise<Sample | void>) => {
    try {
      const next = await job();
      if (next) queryClient.setQueryData(key, next);
      void queryClient.invalidateQueries({ queryKey: sampleKeys.list });
    } catch (e) {
      void message.error(errorMessage(e, t));
      void queryClient.invalidateQueries({ queryKey: key });
    }
  });

  const errorKey = `sample.error.${sample.error_code ?? "unknown"}`;
  const explain = t(isMessageKey(errorKey) ? errorKey : "sample.error.unknown");
  const stepStatus = failed ? "error" : sample.status === "READY" ? "finish" : sample.status === "CANCELED" ? "wait" : "process";

  return (
    <Page
      name="template"
      title={t("sample.pageTitle")}
      extra={
        <Space wrap>
          {running && (
            <ConfirmButton
              label={t("sample.cancel")}
              title={t("sample.cancelTitle")}
              onConfirm={() => act.run(() => samples.cancel(sample.id))}
            />
          )}
          {(failed || sample.status === "CANCELED") && (
            <Button type="primary" loading={act.pending} onClick={() => void act.run(() => samples.retry(sample.id))}>
              {t("sample.retry")}
            </Button>
          )}
          {!running && (
            <ConfirmButton
              danger
              label={t("sample.delete")}
              title={t("sample.deleteTitle")}
              onConfirm={() =>
                act.run(async () => {
                  await samples.remove(sample.id);
                  void message.success(t("sample.deleted"));
                  navigate("/templates", { replace: true });
                  queryClient.removeQueries({ queryKey: key });
                })
              }
            />
          )}
          <GuardedLink to="/templates" dirty={false}>
            {t("tpl.back")}
          </GuardedLink>
        </Space>
      }
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Space wrap>
          <SampleStatusTag status={sample.status} />
          <Typography.Text type="secondary" data-testid="sample-facts">
            {(sample.file_kind ?? "").toUpperCase()} · {t("sample.pages", { n: sample.pages ?? 1 })} ·{" "}
            {t("sample.expires", { date: formatTime(sample.expires_at) })}
          </Typography.Text>
        </Space>
        {sample.status !== "READY" && (
          <Card>
            <Space direction="vertical" size="middle" style={{ width: "100%" }}>
              <Steps
                current={failed && sample.failed_stage === "GENERATE" ? 2 : STEP[sample.status]}
                status={stepStatus}
                items={[
                  { title: t("sample.step.queued") },
                  { title: t("sample.step.ocr") },
                  { title: t("sample.step.generate") },
                  { title: t("sample.step.ready") },
                ]}
              />
              {running && <Alert type="info" showIcon icon={<Spin size="small" />} message={t("sample.running")} />}
              {failed && (
                <Alert
                  role="alert"
                  type="error"
                  showIcon
                  message={t("sample.failed")}
                  description={
                    <>
                      <div>{explain}</div>
                      <div>{t(sample.failed_stage === "GENERATE" ? "sample.retryGenerate" : "sample.retryOcr")}</div>
                    </>
                  }
                />
              )}
              {sample.status === "CANCELED" && <Alert type="warning" showIcon message={t("sample.canceled")} />}
            </Space>
          </Card>
        )}
        {sample.status === "READY" && sample.candidate && <Candidate sample={sample} candidate={sample.candidate} />}
      </Space>
    </Page>
  );
}

/** /templates/samples/:id: the admin's own sample, read again every 2 s until it settles,
 * then its candidate (FR-SYS-142, FR-TEMPLATE-008/014). */
export function TemplateSamplePage() {
  const t = useT();
  const id = useParams().id ?? "";
  const sample = useQuery({
    queryKey: sampleKeys.one(id),
    queryFn: () => samples.get(id),
    enabled: Boolean(id),
    refetchOnWindowFocus: false, // the editor works on what was first read
    refetchInterval: (q) => (q.state.data && SAMPLE_RUNNING.includes(q.state.data.status) ? 2000 : false),
  });
  if (sample.error instanceof ApiError && sample.error.status === 404) {
    return <Result status="404" title={t("common.notFound")} />;
  }
  if (sample.isError) return <ErrorText error={sample.error} />;
  if (!sample.data) return <Spin style={{ display: "block", marginTop: 80 }} />;
  return <SampleView key={sample.data.id} sample={sample.data} />;
}
