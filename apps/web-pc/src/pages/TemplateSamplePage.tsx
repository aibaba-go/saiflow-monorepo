import { TemplateEditor, validateTemplateClient, type PendingConfirmation, type TemplateContent } from "@saiflow/ui/template-editor";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Col, Result, Row, Space, Spin, Steps } from "antd";
import { useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { ConfirmButton } from "../components/ConfirmButton";
import { Page } from "../components/Page";
import { formatBangkokDate } from "../format";
import { useSubmit } from "../hooks/useSubmit";
import { isMessageKey, useT } from "../i18n";
import { ApiError, errorMessage } from "../services/errors";
import {
  cancelSample,
  createTemplate,
  deleteSample,
  pickContent,
  remapPending,
  retrySample,
  RUNNING,
  sameJson,
  useSample,
  type Sample,
} from "../templates/api";
import { ProblemAlert, problemOf, SamplePages, TemplateGate, useLeaveGuard, type Problem } from "../templates/common";
import { useEditorLabels } from "../templates/labels";
import { useTenant } from "../tenants/useTenant";

const STEP: Record<Sample["status"], number> = {
  QUEUED: 0,
  OCR_RUNNING: 1,
  GENERATING: 2,
  READY: 3,
  FAILED: 1,
  CANCELED: 0,
};

/** READY: the original beside the generated structure; nothing exists until "Save as
 * draft" creates the template with the suggestions still to confirm (FR-TEMPLATE-008). */
function Candidate({ sample }: { sample: Sample & { candidate: NonNullable<Sample["candidate"]> } }) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const { tenant } = useTenant();
  const labels = useEditorLabels();
  const initial = useMemo(
    () => ({
      content: pickContent(sample.candidate.content),
      pending: sample.candidate.suggestions.map((s): PendingConfirmation => ({ path: s.path, attr: s.attr, value: s.value })),
    }),
    [sample.candidate],
  );
  const [content, setContent] = useState<TemplateContent>(initial.content);
  const [pending, setPending] = useState<PendingConfirmation[]>(initial.pending);
  const [problem, setProblem] = useState<Problem | null>(null);
  const dirty = !sameJson(content, initial.content) || !sameJson(pending, initial.pending);
  const { leave, guard } = useLeaveGuard(dirty);
  const errors = useMemo(() => validateTemplateClient(content), [content]);

  const save = useSubmit(async () => {
    setProblem(null);
    try {
      const created = await createTemplate(content, "sample", { sampleId: sample.id, pending });
      queryClient.setQueryData(["managed-template", tenant?.tenant_id, created.id], created);
      void queryClient.invalidateQueries({ queryKey: ["managed-templates"] });
      void message.success(t("tpl.created"));
      leave(() => navigate(`/templates/${created.id}`));
    } catch (e) {
      setProblem(problemOf(e, content));
    }
  });

  return (
    <>
      <Alert type="info" showIcon message={t("sample.readyNote")} />
      <ProblemAlert problem={problem} />
      <Space>
        <Button type="primary" loading={save.pending} onClick={() => void save.run()}>
          {t("sample.saveDraft")}
        </Button>
      </Space>
      <Row gutter={16}>
        <Col xs={24} lg={10}>
          <SamplePages sampleId={sample.id} pageCount={sample.pages} />
        </Col>
        <Col xs={24} lg={14}>
          <section className="pc-panel" aria-label={t("sample.pageTitle")}>
            <TemplateEditor
              value={content}
              onChange={setContent}
              errors={errors}
              sampleValues={sample.candidate.values}
              pendingConfirmations={pending}
              onConfirm={(path, attr) => setPending((list) => list.filter((p) => !(p.path === path && p.attr === attr)))}
              onPathsRemap={(remap) => setPending((list) => remapPending(list, remap))}
              labels={labels}
            />
          </section>
        </Col>
      </Row>
      {guard}
    </>
  );
}

function SampleView({ sample }: { sample: Sample }) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const { tenant } = useTenant();
  const key = ["template-sample", tenant?.tenant_id, sample.id];
  const running = RUNNING.includes(sample.status);
  const failed = sample.status === "FAILED";

  const act = useSubmit(async (job: () => Promise<Sample | void>) => {
    try {
      const next = await job();
      if (next) queryClient.setQueryData(key, next);
      void queryClient.invalidateQueries({ queryKey: ["template-samples"] });
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
      name="templates"
      title={t("sample.pageTitle")}
      meta={
        <span>
          {t("sample.expires", { date: formatBangkokDate(sample.expires_at) })} · {t("sample.charged", { n: sample.charged_pages })}
        </span>
      }
      extra={
        <Space>
          {running && (
            <ConfirmButton label={t("sample.cancel")} title={t("sample.cancelTitle")} onConfirm={() => act.run(() => cancelSample(sample.id))} />
          )}
          {(failed || sample.status === "CANCELED") && (
            <Button type="primary" loading={act.pending} onClick={() => void act.run(() => retrySample(sample.id))}>
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
                  await deleteSample(sample.id);
                  void message.success(t("sample.deleted"));
                  navigate("/templates", { replace: true });
                  queryClient.removeQueries({ queryKey: key });
                })
              }
            />
          )}
        </Space>
      }
    >
      {sample.status !== "READY" && (
        <section className="pc-panel" aria-label={t("sample.pageTitle")}>
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
        </section>
      )}
      {sample.status === "READY" && sample.candidate && <Candidate sample={{ ...sample, candidate: sample.candidate }} />}
    </Page>
  );
}

function SampleLoader() {
  const t = useT();
  const id = useParams().id ?? "";
  const sample = useSample(id);
  if (sample.error instanceof ApiError && sample.error.status === 404) {
    return <Result status="404" title={t("common.notFound")} />;
  }
  if (sample.error) return <Alert role="alert" type="error" showIcon message={errorMessage(sample.error, t)} />;
  if (!sample.data) return <Spin />;
  return <SampleView key={sample.data.id} sample={sample.data} />;
}

/** /templates/samples/:id: a sample's progress, read again every 2 s until it settles,
 * then the generated candidate (FR-TEMPLATE-002/008/014). */
export function TemplateSamplePage() {
  return (
    <TemplateGate>
      <SampleLoader />
    </TemplateGate>
  );
}
