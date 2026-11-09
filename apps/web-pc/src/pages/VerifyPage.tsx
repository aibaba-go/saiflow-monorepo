import { useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Drawer, Empty, List, Modal, Space, Spin, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useBlocker, useNavigate, useParams } from "react-router-dom";

import { useMe } from "../auth/session";
import { ErrorText } from "../components/ErrorText";
import { Page } from "../components/Page";
import { formatBangkokDateTime } from "../format";
import { isMessageKey, useT } from "../i18n";
import { applyTemplate, chooseGeneric, type JobOut, type ResultOut, saveResult, useJob, useJobs, useResult } from "../ocr/api";
import { EditableResult } from "../ocr/EditableResult";
import { canEditJob, jobTarget } from "../ocr/stage";
import { useUnsaved } from "../ocr/unsaved";
import { getAt, type Group, type Json } from "../ocr/structured";
import { type SwitchTarget, TemplateSwitch } from "../ocr/TemplateSwitch";
import { useChanges } from "../reviews/api";
import { ChangeLogTable } from "../reviews/ChangeLogTable";
import { OriginalPages } from "../reviews/OriginalPages";
import { ApiError } from "../services/errors";
import { useLanguage } from "../stores/language";
import { can } from "../tenants/permissions";
import { ReturnedTag, StageTag } from "../ocr/StageTag";
import { Icon } from "../layout/icons";
import { useTenant } from "../tenants/useTenant";

type Draft = { jobId: string; base: number; value: Json };

function failureText(code: string | null | undefined, t: ReturnType<typeof useT>): string {
  const key = `ocrerr.${code ?? ""}`;
  return isMessageKey(key) ? t(key) : t("ocrerr.unknown");
}

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** "document.date" / "goods.items[1].qty" as a path for getAt. */
const pathParts = (p: string): (string | number)[] =>
  p
    .split(/\.|\[(\d+)\]/)
    .filter((x) => x !== undefined && x !== "")
    .map((x) => (/^\d+$/.test(x) ? Number(x) : x));
const blank = (v: unknown) => v === null || v === undefined || (typeof v === "string" && !v.trim());

/** The right column for one task: notices, the editable result and its actions. */
function Workspace({ job, queue }: { job: JobOut; queue: JobOut[] }) {
  const t = useT();
  const lang = useLanguage((s) => s.lang);
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const result = useResult(job.id);
  const [draft, setDraft] = useState<Draft | null>(null);
  // paths the server said were missing, with the content they were judged on
  const [missing, setMissing] = useState<{ paths: string[]; at: Json }>({ paths: [], at: null });
  const [expired, setExpired] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const [switching, setSwitching] = useState(false);
  const [lastApplied, setLastApplied] = useState<SwitchTarget | null>(null);
  const [logOpen, setLogOpen] = useState(false);
  const changes = useChanges(job.id, logOpen);
  const leaving = useRef(false);

  const { tenant } = useTenant();
  const data = result.data;
  const value: Json = draft && draft.jobId === job.id ? draft.value : ((data?.structured ?? {}) as Json);
  const dirty = Boolean(data && draft && draft.jobId === job.id && !same(draft.value, data.structured));

  // Unsaved edits: ask before any navigation (left column, menu, back) and before closing.
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) =>
      dirty && !leaving.current && currentLocation.pathname !== nextLocation.pathname,
  );
  const setUnsaved = useUnsaved((s) => s.setDirty);
  useEffect(() => {
    setUnsaved(dirty);
    return () => setUnsaved(false);
  }, [dirty, setUnsaved]);
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);

  // the saved result goes straight into the cache, so the fields never show the old values
  const loaded = (body: ResultOut) => {
    queryClient.setQueryData(["result", tenant?.tenant_id, job.id], body);
    setDraft(null);
    void queryClient.invalidateQueries({ queryKey: ["result"] });
  };

  // The edit's own base version, so a colleague's save in between is a conflict, not
  // silently overwritten (final review 1).
  async function save(confirm: boolean, version?: number): Promise<ResultOut | null> {
    if (!data) return null;
    setBusy(true);
    setError(null);
    setExpired(false);
    try {
      const edits = !confirm || version === undefined ? dirty : false;
      const base = version ?? (dirty && draft ? draft.base : data.version);
      const body = await saveResult(job.id, base, edits ? value : null, confirm);
      setMissing({ paths: [], at: null });
      if (!confirm) loaded(body);
      return body;
    } catch (e) {
      if (e instanceof ApiError && e.code === "required_missing") {
        const paths = e.fields.map((f) => f.replace(/^structured\./, ""));
        setMissing({ paths, at: value });
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
    // Edits are saved as a draft first, so a refused confirm (plan expired, missing
    // fields) loses nothing (FR-SYS-129; final review 2).
    let version: number | undefined;
    if (dirty) {
      const saved = await save(false);
      if (!saved) return;
      version = saved.version;
    }
    const body = await save(true, version ?? data?.version);
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
  // a mark clears as soon as the user fills the field in (minor-fixes-ui)
  const stillMissing = (p: string, judged: Json) => {
    const now = getAt(value, pathParts(p));
    return blank(now) || same(now, getAt(judged, pathParts(p)));
  };
  // retry the conversion that failed: the one switched to here, else the one the result names
  const retryTarget: SwitchTarget | null =
    lastApplied ??
    (mapping?.template_version_id ? { kind: "template", versionId: mapping.template_version_id, name: "" } : null);
  const editable = !data.confirmed && !busy && !converting;

  return (
    <div className="pc-editor">
      <div className="pc-editor__top">
        <strong>{t("editor.title")}</strong>
        <span className="pc-ai-label">
          <Icon name="spark" />
          {t("editor.aiPending")}
        </span>
      </div>
      <div className="pc-editor__body">
        <div className="pc-editor__template">
          <span>
            {t("table.template")} <strong>{data.template?.name ?? t("review.generic")}</strong>
          </span>
          <Button size="small" disabled={!editable} onClick={() => setSwitching(true)}>
            {t("ocr.changeTemplate")}
          </Button>
        </div>
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
                {retryTarget && (
                  <Button size="small" onClick={() => void switchTo(retryTarget)}>
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
        <EditableResult
          value={value}
          groups={groups}
          missing={
            new Set([
              ...data.missing_required.filter((p) => stillMissing(p, (data.structured ?? null) as Json)),
              ...missing.paths.filter((p) => stillMissing(p, missing.at)),
            ])
          }
          warnings={new Set((data.warnings ?? []).map((w) => w.path))}
          amountIssues={new Map((data.amount_issues ?? []).map((a) => [a.path, a.computed]))}
          editable={editable}
          onChange={(next) => setDraft({ jobId: job.id, base: data.version, value: next })}
        />
        <p className="pc-editor__notice">
          <Icon name="info" />
          {t("editor.noticeVerify")}
        </p>
      </div>
      <div className="pc-editor__actions">
        <Button type="link" className="pc-ghost" icon={<Icon name="history" />} onClick={() => setLogOpen(true)}>
          {t("review.changes")}
        </Button>
        <span className="pc-editor__primary">
          <Button disabled={!editable || !dirty} loading={busy} onClick={() => void save(false)}>
            {t("ocr.saveDraft")}
          </Button>
          <Button type="primary" icon={<Icon name="check" />} disabled={!editable} loading={busy} onClick={() => void confirm()}>
            {t("ocr.confirm")}
          </Button>
        </span>
      </div>
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
    </div>
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
  const me = useMe();
  const queue = useJobs({ page: 1, pageSize: 100, stage: "VERIFYING" });
  // only the jobs this user may change (final review 3)
  const items = (queue.data?.items ?? []).filter((j) => canEditJob(j, tenant, me.data?.user_id));
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
  if (id && current.data && me.data && !canEditJob(current.data, tenant, me.data.user_id)) {
    return <Navigate to={`/documents/${id}`} replace />;
  }
  if (id && current.isError) return <Navigate to="/verify" replace />;

  const job = id ? (current.data ?? items.find((j) => j.id === id)) : undefined;
  return (
    <Page
      name="verify"
      title={t("nav.verify")}
      description={t("layout.desc.verify")}
      badge={job && <StageTag stage={job.stage} level={job.review_level} />}
      extra={
        <Button icon={<Icon name="back" />} onClick={() => navigate("/library")}>
          {t("detail.back")}
        </Button>
      }
    >
      <div className="pc-verify">
        <aside className="pc-verify__queue pc-queue">
          <div className="pc-queue__header">
            <span>{t("wb.queue")}</span>
            <span className="num">{String(items.length).padStart(2, "0")}</span>
          </div>
          <List<JobOut>
            data-testid="verify-queue"
            size="small"
            loading={queue.isPending}
            locale={{ emptyText: t("ocr.noneToVerify") }}
            dataSource={items}
            renderItem={(j) => (
              <List.Item
                className={`pc-queue__item${j.id === id ? " is-selected" : ""}`}
                aria-current={j.id === id ? "true" : undefined}
                onClick={() => j.id !== id && navigate(`/verify/${j.id}`)}
              >
                <span className="pc-queue__type">
                  <span>{j.template_name ?? t("review.generic")}</span>
                  <Icon name="file" />
                </span>
                <strong className="pc-queue__name">{j.file_name}</strong>
                <span className="pc-queue__time num">{formatBangkokDateTime(j.created_at)}</span>
                <span className="pc-queue__tags">
                  <StageTag stage={j.stage} level={j.review_level} />
                  {j.returned && <ReturnedTag />}
                </span>
              </List.Item>
            )}
          />
          <p className="pc-queue__note">{t("wb.queueNote")}</p>
        </aside>
        {job ? (
          <>
            <div className="pc-verify__original">
              <OriginalPages key={job.id} fileId={job.file_id} fileName={job.file_name} pageCount={job.page_count} />
            </div>
            <section className="pc-verify__editor">
              <Workspace key={job.id} job={job} queue={items} />
            </section>
          </>
        ) : (
          <div className="pc-verify__empty pc-panel">
            {queue.isPending ? (
              <Spin />
            ) : (
              <Empty image={<Icon name="check" className="pc-empty__icon" />} description={t("ocr.noneToVerify")}>
                <p className="pc-empty__body">{t("wb.emptyBody")}</p>
                <Button onClick={() => navigate("/library")}>{t("wb.toLibrary")}</Button>
              </Empty>
            )}
          </div>
        )}
      </div>
    </Page>
  );
}
