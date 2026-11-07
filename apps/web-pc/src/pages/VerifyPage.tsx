import { useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Col, Drawer, Empty, List, Modal, Row, Space, Spin, Tag, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useBlocker, useNavigate, useParams } from "react-router-dom";

import { ErrorText } from "../components/ErrorText";
import { Page } from "../components/Page";
import { formatBangkokDateTime } from "../format";
import { isMessageKey, useT } from "../i18n";
import { applyTemplate, chooseGeneric, type JobOut, type ResultOut, saveResult, useJob, useJobs, useResult } from "../ocr/api";
import { EditableResult } from "../ocr/EditableResult";
import { jobTarget } from "../ocr/stage";
import type { Group, Json } from "../ocr/structured";
import { type SwitchTarget, TemplateSwitch } from "../ocr/TemplateSwitch";
import { useChanges } from "../reviews/api";
import { ChangeLogTable } from "../reviews/ChangeLogTable";
import { OriginalPages } from "../reviews/OriginalPages";
import { ApiError } from "../services/errors";
import { useLanguage } from "../stores/language";
import { can } from "../tenants/permissions";
import { useTenant } from "../tenants/useTenant";

type Draft = { jobId: string; base: number; value: Json };

function failureText(code: string | null | undefined, t: ReturnType<typeof useT>): string {
  const key = `ocrerr.${code ?? ""}`;
  return isMessageKey(key) ? t(key) : t("ocrerr.unknown");
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** The right column for one task: notices, the editable result and its actions. */
function Workspace({ job, queue }: { job: JobOut; queue: JobOut[] }) {
  const t = useT();
  const lang = useLanguage((s) => s.lang);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const result = useResult(job.id);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [missing, setMissing] = useState<string[]>([]);
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [lastApplied, setLastApplied] = useState<SwitchTarget | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const changes = useChanges(job.id, logOpen);
  const leaving = useRef(false);

  const data = result.data;
  const value: Json = draft && draft.jobId === job.id ? draft.value : ((data?.structured ?? {}) as Json);
  const dirty = Boolean(data && draft && draft.jobId === job.id && !same(draft.value, data.structured));

  // Unsaved edits: ask before any navigation (left column, menu, back) and before closing.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !leaving.current && currentLocation.pathname !== nextLocation.pathname,
  );
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);

  const loaded = () => {
    void queryClient.invalidateQueries({ queryKey: ["result"] });
    setDraft(null);
  };

  async function save(confirm: boolean): Promise<ResultOut | null> {
    if (!data) return null;
    setBusy(true);
    setError(null);
    setExpired(false);
    try {
      const body = await saveResult(job.id, data.version, dirty ? value : null, confirm);
      setMissing([]);
      if (!confirm) loaded();
      return body;
    } catch (e) {
      if (e instanceof ApiError && e.code === "required_missing") {
        const paths = e.fields.map((f) => f.replace(/^structured\./, ""));
        setMissing(paths);
        setTimeout(() => document.querySelector(`[data-path="${paths[0]}"]`)?.scrollIntoView?.({ block: "center" }), 0);
      } else if (e instanceof ApiError && e.code === "plan_expired") {
        setExpired(true);
      } else if (e instanceof ApiError && e.code === "version_conflict") {
        void message.warning(t("ocr.changedByOthers"));
        setDraft(null);
        await queryClient.invalidateQueries({ queryKey: ["result"] });
      } else {
        setError(e);
      }
      return null;
    } finally {
      setBusy(false);
    }
  }

  async function confirm() {
    const body = await save(true);
    if (!body) return;
    const toReview = body.review?.stage === "PENDING_L1" || body.review?.stage === "PENDING_L2";
    void message.success(t(toReview ? "ocr.submitted" : "ocr.confirmed"));
    leaving.current = true;
    setDraft(null);
    await queryClient.invalidateQueries({ queryKey: ["jobs"] });
    const next = queue.find((j) => j.id !== job.id);
    navigate(next ? `/verify/${next.id}` : "/verify", { replace: true });
  }

  async function switchTo(target: SwitchTarget) {
    setSwitching(false);
    if (dirty && !(await save(false))) return;
    setBusy(true);
    try {
      if (target.kind === "generic") await chooseGeneric(job.id);
      else await applyTemplate(job.id, target.versionId);
      setLastApplied(target);
      setDraft(null);
      await queryClient.invalidateQueries({ queryKey: ["result"] });
      await queryClient.invalidateQueries({ queryKey: ["job"] });
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  if (result.isError) return <ErrorText error={result.error} />;
  if (!data) return <Spin />;
  const groups = (data.template?.groups ?? null) as Group[] | null;
  const mapping = data.mapping;
  const converting = mapping && ["PENDING", "MATCHING", "CONVERTING"].includes(mapping.status);
  const back = data.review?.last_return;
  const editable = !data.confirmed && !busy && !converting;

  return (
    <Space direction="vertical" style={{ width: "100%" }}>
      {back && (
        <Alert
          data-testid="return-banner"
          type="warning"
          showIcon
          message={t("review.lastReturn", {
            level: t(back.level === 2 ? "review.level2" : "review.level1"),
            name: back.reviewer_name ?? "-",
            time: formatBangkokDateTime(back.created_at),
          })}
          description={back.comment}
        />
      )}
      {converting && <Alert type="info" showIcon message={t("ocr.converting")} />}
      {mapping?.status === "FAILED" && (
        <Alert
          type="error"
          showIcon
          message={`${t("ocr.conversionFailed")} ${failureText(mapping.error, t)}`}
          action={
            <Space>
              {lastApplied && (
                <Button size="small" onClick={() => void switchTo(lastApplied)}>
                  {t("common.retry")}
                </Button>
              )}
              <Button size="small" onClick={() => setSwitching(true)}>
                {t("ocr.changeTemplate")}
              </Button>
            </Space>
          }
        />
      )}
      {(data.warnings ?? []).length > 0 && <Alert type="warning" showIcon message={t("ocr.typeWarnings")} />}
      {(data.amount_issues ?? []).length > 0 && (
        <Alert type="warning" showIcon message={t("ocr.amountIssues", { n: data.amount_issues!.length })} />
      )}
      {expired && (
        <Alert type="error" showIcon message={t("err.plan_expired")} action={<Link to="/plans">{t("nav.plans")}</Link>} />
      )}
      <ErrorText error={error} />
      <Typography.Text type="secondary">
        {t("review.col.template")}: {data.template?.name ?? t("review.generic")}
      </Typography.Text>
      <EditableResult
        value={value}
        groups={groups}
        missing={new Set([...data.missing_required, ...missing])}
        warnings={new Set((data.warnings ?? []).map((w) => w.path))}
        amountIssues={new Map((data.amount_issues ?? []).map((a) => [a.path, a.computed]))}
        editable={editable}
        onChange={(next) => setDraft({ jobId: job.id, base: data.version, value: next })}
      />
      <Space wrap>
        <Button disabled={!editable || !dirty} loading={busy} onClick={() => void save(false)}>
          {t("ocr.saveDraft")}
        </Button>
        <Button disabled={!editable} onClick={() => setSwitching(true)}>
          {t("ocr.changeTemplate")}
        </Button>
        <Button onClick={() => setLogOpen(true)}>{t("review.changes")}</Button>
        <Button type="primary" disabled={!editable} loading={busy} onClick={() => void confirm()}>
          {t("ocr.confirm")}
        </Button>
      </Space>
      <TemplateSwitch jobId={job.id} open={switching} onClose={() => setSwitching(false)} onChoose={(o) => void switchTo(o)} />
      <Drawer open={logOpen} title={t("review.changes")} width={720} onClose={() => setLogOpen(false)}>
        <ChangeLogTable entries={changes.data ?? []} groups={groups as never} t={t} lang={lang} />
      </Drawer>
      <Modal
        open={blocker.state === "blocked"}
        title={t("ocr.leaveTitle")}
        okText={t("ocr.discard")}
        cancelText={t("common.cancel")}
        okButtonProps={{ danger: true }}
        onOk={() => blocker.proceed?.()}
        onCancel={() => blocker.reset?.()}
      >
        {t("ocr.leaveBody")}
      </Modal>
    </Space>
  );
}

/** The verify page (FR-SYS-129): tasks to verify on the left, the original in the middle,
 * the editable result on the right. A task that is no longer to verify opens where its
 * stage belongs; a tenant switch starts again from the list. */
export function VerifyPage() {
  const t = useT();
  const navigate = useNavigate();
  const { id } = useParams();
  const { tenant } = useTenant();
  const queue = useJobs({ page: 1, pageSize: 100, stage: "VERIFYING" });
  const items = queue.data?.items ?? [];
  const current = useJob(id ?? "");
  const tenantId = useRef(tenant?.tenant_id);

  useEffect(() => {
    if (tenantId.current !== undefined && tenantId.current !== tenant?.tenant_id) navigate("/verify", { replace: true });
    tenantId.current = tenant?.tenant_id;
  }, [tenant?.tenant_id, navigate]);

  if (!can(tenant, "verify_own") && !can(tenant, "verify_others")) {
    return (
      <Page name="verify" title={t("nav.verify")}>
        <Typography.Text>{t("ocr.noVerifyPermission")}</Typography.Text>
      </Page>
    );
  }
  if (!id && items.length) return <Navigate to={`/verify/${items[0]!.id}`} replace />;
  if (id && current.data && current.data.stage !== "VERIFYING") return <Navigate to={jobTarget(current.data, true)} replace />;
  if (id && current.isError) return <Navigate to="/verify" replace />;

  const job = id ? (current.data ?? items.find((j) => j.id === id)) : undefined;
  return (
    <Page name="verify" title={t("nav.verify")}>
      <Row gutter={16}>
        <Col span={5}>
          <Card size="small" title={t("ocr.toVerify", { n: items.length })}>
            <List<JobOut>
              data-testid="verify-queue"
              size="small"
              loading={queue.isPending}
              locale={{ emptyText: t("ocr.noneToVerify") }}
              dataSource={items}
              renderItem={(j) => (
                <List.Item
                  style={{ cursor: "pointer", background: j.id === id ? "#e6f4ff" : undefined }}
                  onClick={() => j.id !== id && navigate(`/verify/${j.id}`)}
                >
                  <Space direction="vertical" size={0}>
                    <Typography.Text strong>{j.file_name}</Typography.Text>
                    <Typography.Text type="secondary">{j.template_name ?? t("review.generic")}</Typography.Text>
                    <Typography.Text type="secondary">{formatBangkokDateTime(j.created_at)}</Typography.Text>
                    {j.returned && <Tag color="red">{t("ocr.returned")}</Tag>}
                  </Space>
                </List.Item>
              )}
            />
          </Card>
        </Col>
        {job ? (
          <>
            <Col span={9}>
              <Card size="small" title={job.file_name}>
                <OriginalPages key={job.id} fileId={job.file_id} fileName={job.file_name} pageCount={job.page_count} />
              </Card>
            </Col>
            <Col span={10}>
              <Workspace key={job.id} job={job} queue={items} />
            </Col>
          </>
        ) : (
          <Col span={19}>{queue.isPending ? <Spin /> : <Empty description={t("ocr.noneToVerify")} />}</Col>
        )}
      </Row>
    </Page>
  );
}
