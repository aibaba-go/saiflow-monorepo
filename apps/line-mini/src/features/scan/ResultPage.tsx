import type { components } from "@saiflow/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { BrandLoading } from "../../components/BrandLoading";
import { useT } from "../../i18n";
import { api, call } from "../../services/api";
import { ApiError, errorMessage } from "../../services/errors";
import { useSession } from "../../stores/session";
import { formatBangkokDateTime } from "../../utils/format";
import { can } from "../tenants/permissions";
import { useCurrentTenant } from "../tenants/useCurrentTenant";
import { applyTemplate, chooseGeneric, rerunJob, saveResult } from "./api";
import { ChangeLog } from "./components/ChangeLog";
import { FormDialog, fd } from "./components/FormDialog";
import { OriginalPreview } from "./components/OriginalPreview";
import { PageHeader } from "./components/PageHeader";
import { StatusChip } from "./components/StatusChip";
import { StructuredDataView } from "./components/StructuredDataView";
import { TemplatePanel, type SwitchTarget } from "./components/TemplatePanel";
import { confirmResult, scrollToField, wantsConfirm } from "./confirm";
import { failureText, POLL_MS, useJob } from "./ProcessingPage";
import s from "./ResultPage.module.css";
import { isTable, type Group, type Json } from "./structured";
import theme from "./theme.module.css";

export type ResultOut = components["schemas"]["ResultOut"];
const RUNNING = new Set(["PENDING", "MATCHING", "CONVERTING"]);
export const PENDING_TIMEOUT_MS = 10 * 60_000;

export function useResult(id: string) {
  const { tenant } = useCurrentTenant();
  return useQuery({
    queryKey: ["result", tenant?.tenant_id, id],
    queryFn: () => call(api.GET("/api/v1/ocr/jobs/{job_id}/result", { params: { path: { job_id: id } } })),
    refetchInterval: (q) => (q.state.data?.mapping && RUNNING.has(q.state.data.mapping.status) ? POLL_MS : false),
  });
}

function tableCount(value: Json): number {
  if (!value || typeof value !== "object" || Array.isArray(value)) return 0;
  let n = 0;
  for (const v of Object.values(value)) {
    if (isTable(v) && v.length) n += 1;
    else if (v && typeof v === "object" && !Array.isArray(v))
      for (const inner of Object.values(v)) if (isTable(inner) && inner.length) n += 1;
  }
  return n;
}

const cx = (...n: (string | false | undefined)[]) => n.filter(Boolean).map((k) => s[k as string] ?? k).join(" ");

/** main `ResultPage.vue` (FR-SYS-105, 106, 114, 115): chips and meta, the template button
 * and notices, the original, the editor with a Table / JSON switch, Reset and Continue
 * (save, then confirm). Free-form with no error when nothing fits (FR-OCR-019). */
export function ResultPage() {
  const t = useT();
  const navigate = useNavigate();
  const client = useQueryClient();
  const { id = "" } = useParams();
  const job = useJob(id, false);
  const result = useResult(id);
  const me = useSession((st) => st.me);
  const { tenant } = useCurrentTenant();
  const [draft, setDraft] = useState<{ base: number; value: Json } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const [expired, setExpired] = useState(false);
  const [selecting, setSelecting] = useState(false);
  const [switchTo, setSwitchTo] = useState<SwitchTarget | null>(null);
  const [lastApplied, setLastApplied] = useState<SwitchTarget | null>(null);
  const [confirmingReset, setConfirmingReset] = useState(false);
  const [tab, setTab] = useState<"table" | "json">("table");
  const [copied, setCopied] = useState<string | null>(null);
  const [pendingExpired, setPendingExpired] = useState(false);
  const autoConfirm = useRef(false);
  const data = result.data;
  const dirty = draft !== null && data !== undefined && draft.base === data.version;
  const value = (dirty ? draft.value : (data?.structured ?? {})) as Json;
  const mapping = data?.mapping;
  const pending = mapping ? RUNNING.has(mapping.status) : false;
  const locked = Boolean(data?.confirmed);
  const groups = (data?.template?.groups ?? null) as Group[] | null;
  const busy = saving || pending;

  // A conversion still running after 10 minutes (main template.timeout).
  useEffect(() => {
    if (!pending) return;
    const timer = setTimeout(() => setPendingExpired(true), PENDING_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [pending]);

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(timer);
  }, [toast]);

  async function reload() {
    setDraft(null);
    await client.invalidateQueries({ queryKey: ["result"] });
  }

  /** Save the edits as a draft: the version now current, or null when saving failed. */
  async function saveDraft(): Promise<ResultOut | null> {
    if (!data) return null;
    if (!dirty) return data;
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const saved = await saveResult(id, data.version, draft.value);
      client.setQueriesData({ queryKey: ["result"] }, (old: ResultOut | undefined) =>
        old && old.version === data.version ? saved : old,
      );
      setDraft(null);
      return saved;
    } catch (e) {
      if (e instanceof ApiError && e.code === "version_conflict") {
        setNotice(t("scan.conflict"));
        await reload();
      } else setError(e);
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function confirm() {
    setExpired(false);
    const saved = await saveDraft();
    if (!saved) return;
    setSaving(true);
    try {
      const out = await confirmResult(id, saved.version, (saved.structured ?? {}) as Json);
      if (out.kind === "confirmed") {
        void client.invalidateQueries({ queryKey: ["jobs"] });
        void client.invalidateQueries({ queryKey: ["job"] });
        client.setQueriesData({ queryKey: ["result"] }, () => out.result);
        void client.invalidateQueries({ queryKey: ["reviewSummary"] });
        // into review: the final page says so (FR-SYS-106)
        const submitted = out.result.review?.stage === "PENDING_L1" || out.result.review?.stage === "PENDING_L2";
        navigate(`/scan/jobs/${id}/final`, { replace: true, state: submitted ? { submitted: true } : null });
      } else if (out.kind === "missing") {
        setMissing(out.paths);
        if (out.paths[0]) setTimeout(() => scrollToField(out.paths[0]!), 0);
      } else if (out.kind === "error") {
        if (out.error.code === "plan_expired") setExpired(true);
        setError(out.error);
      }
    } finally {
      setSaving(false);
    }
  }

  // Back from LINE login or registration with a confirm waiting (AC-FR-SYS-106-01).
  const registered = me?.kind === "user" && me.registered;
  useEffect(() => {
    if (!data || !registered || autoConfirm.current || !wantsConfirm(id)) return;
    autoConfirm.current = true;
    void confirm();
  });

  async function doSwitch(target: SwitchTarget) {
    setSwitchTo(null);
    setError(null);
    if (!(await saveDraft())) return;
    setSaving(true);
    try {
      if (target === "generic") await chooseGeneric(id);
      else await applyTemplate(id, target);
      setLastApplied(target);
      setPendingExpired(false);
      setToast(t("template.applying"));
      void client.invalidateQueries({ queryKey: ["template-options", id] });
      await reload();
    } catch (e) {
      if (e instanceof ApiError && e.code === "version_conflict") setNotice(t("template.versionConflict"));
      else setError(e);
    } finally {
      setSaving(false);
    }
  }

  function requestSwitch(target: SwitchTarget) {
    setSelecting(false);
    if (dirty) setSwitchTo(target);
    else void doSwitch(target);
  }

  async function copyJson() {
    try {
      await navigator.clipboard.writeText(JSON.stringify(value, null, 2));
      setCopied(t("result.copied"));
    } catch {
      setCopied(t("result.copyFailed"));
    }
  }

  const failed = job.data?.stage === "OCR_FAILED";
  const isGuest = me?.kind !== "user";
  // Changing a result needs verify_own for one's own job and verify_others for anyone else's
  // (FR-VERIFY-015, FR-SYS-002); without it the fields are read-only (AC-FR-SYS-105-09).
  // Until the job is known, nothing is editable.
  const ownJob = job.data ? job.data.created_by_user_id == null || job.data.created_by_user_id === me?.user_id : null;
  const mayEdit = ownJob !== null && can(tenant, ownJob ? "verify_own" : "verify_others");
  const current: SwitchTarget = data?.template?.template_version_id ?? "generic";
  const manualFailure = mapping?.status === "FAILED";
  const allMissing = [...new Set([...(data?.missing_required ?? []), ...missing])];
  const reviewKey = locked
    ? "job.review.CONFIRMED"
    : data && data.version > 1
      ? "job.review.EDITED"
      : "job.review.UNREVIEWED";

  return (
    <div className={`${theme.scan} ${s.result}`}>
      <PageHeader title={t("result.title")} onBack={() => navigate("/history")} />

      {failed ? (
        <div className={s.failure}>
          <div className={s["failure-badge"]}>!</div>
          <h2>{job.data?.status === "CANCELLED" ? t("result.cancelledTitle") : t("result.failedTitle")}</h2>
          <p className={s["failure-file"]}>{job.data?.file_name}</p>
          <p className={s["failure-reason"]}>{failureText(job.data?.error_code, t)}</p>
          <button
            type="button"
            className={s["primary-btn"]}
            onClick={() =>
              void rerunJob(id).then(
                (next) => navigate(`/scan/jobs/${next.id}/progress`, { replace: true }),
                (e) => setError(e),
              )
            }
          >
            {t("result.retry")}
          </button>
          <button type="button" className={s["home-btn"]} onClick={() => navigate("/history")}>
            {t("common.back")}
          </button>
        </div>
      ) : result.isError && !data ? (
        <div className={s.fatal}>
          <p className={s["status-error"]}>{errorMessage(result.error, t)}</p>
          <button type="button" className={s["home-btn"]} onClick={() => navigate("/history")}>
            {t("common.back")}
          </button>
        </div>
      ) : data ? (
        <>
          {/* prototype .verify-head: the file, its facts and its state */}
          <div className={s.summary}>
            <div className={s["summary-row"]}>
              <div className={s["summary-text"]}>
                <div className={s["summary-name"]}>{job.data?.file_name ?? ""}</div>
                <div className={s.meta}>
                  {t("result.meta", { pages: job.data?.page_count ?? 1, tables: tableCount(value) })}
                  {job.data?.engine && ` · ${job.data.engine}`}
                </div>
              </div>
              <div className={s.chips}>
                {job.data && <StatusChip stage={job.data.stage} level={job.data.review_level} returned={job.data.returned} />}
                <span className={cx("review-chip", locked && "confirmed", !locked && data.version > 1 && "edited")}>
                  {t(reviewKey)}
                </span>
              </div>
            </div>
          </div>

          <div className={s.content}>
            {job.data && (
              <OriginalPreview fileId={job.data.file_id} fileName={job.data.file_name} pageCount={job.data.page_count || 1} />
            )}
            <button type="button" className={s["template-select"]} disabled={locked || saving} onClick={() => setSelecting(true)}>
              <span className={s["template-caption"]}>{t("template.label")}</span>
              <span>{data.template?.name ?? t("template.generic")}</span>
              {!locked && <span aria-hidden="true">⌄</span>}
            </button>
            {data.match?.low_score && (
              <p className={s["template-notice"]}>
                {t("template.lowScore", { score: Math.round((data.match.score ?? 0) * 100) })}
              </p>
            )}
            {allMissing.length > 0 && (
              <p className={s["template-notice"]}>{t("template.requiredMissing", { n: allMissing.length })}</p>
            )}
            {(data.warnings ?? []).length > 0 && <p className={s["template-notice"]}>{t("template.typeWarnings")}</p>}
            {(data.amount_issues ?? []).length > 0 && (
              <p className={s["template-notice"]}>{t("result.amountIssues", { n: data.amount_issues!.length })}</p>
            )}
            {notice && (
              <p className={s["status-error"]} role="alert">
                {notice}
              </p>
            )}
            {manualFailure && !pending && (
              <div className={cx("template-notice", "danger")} role="alert">
                {t("template.failed")} {failureText(mapping?.error, t)}
                {!locked && (
                  <div className={s["template-actions"]}>
                    {lastApplied !== null && (
                      <button type="button" disabled={saving} onClick={() => requestSwitch(lastApplied)}>
                        {t("common.retry")}
                      </button>
                    )}
                    <button type="button" disabled={saving} onClick={() => setSelecting(true)}>
                      {t("template.chooseOther")}
                    </button>
                    <button type="button" disabled={saving} onClick={() => requestSwitch("generic")}>
                      {t("template.useGeneric")}
                    </button>
                  </div>
                )}
              </div>
            )}

            {data.review?.last_return && (
              <div className={cx("template-notice", "danger")} role="note">
                {t("review.lastReturn", {
                  level: t(data.review.last_return.level === 2 ? "review.level2" : "review.level1"),
                  name: data.review.last_return.reviewer_name ?? "-",
                  time: formatBangkokDateTime(data.review.last_return.created_at),
                })}
                {data.review.last_return.comment && <div>{data.review.last_return.comment}</div>}
              </div>
            )}

            <div className={s["view-tabs"]} role="tablist">
              {(["table", "json"] as const).map((k) => (
                <button
                  type="button"
                  key={k}
                  role="tab"
                  aria-selected={tab === k}
                  className={cx("view-tab", tab === k && "active")}
                  onClick={() => setTab(k)}
                >
                  {k === "table" ? t("result.tabTable") : t("result.tabJson")}
                </button>
              ))}
            </div>

            <div className={s["data-area"]} aria-busy={pending}>
              {tab === "table" ? (
                <StructuredDataView
                  value={value}
                  groups={groups}
                  schemaName={data.template?.name}
                  missing={new Set(allMissing)}
                  warnings={new Set((data.warnings ?? []).map((w) => w.path))}
                  amountIssues={new Map((data.amount_issues ?? []).map((a) => [a.path, a.computed]))}
                  editable={!locked && !busy && mayEdit}
                  onChange={(next) => setDraft({ base: data.version, value: next })}
                />
              ) : (
                <>
                  <button type="button" className={s["copy-btn"]} onClick={() => void copyJson()}>
                    {t("result.copyJson")}
                  </button>
                  {copied && <span role="status">{copied}</span>}
                  <pre className={s["json-view"]}>{JSON.stringify(value, null, 2)}</pre>
                </>
              )}
              {pending && (
                <div className={s["mapping-mask"]} role="status">
                  <BrandLoading variant="inline" label={t("template.applying")} />
                  {pendingExpired && <p>{t("template.timeout")}</p>}
                  <div className={s["template-actions"]}>
                    {pendingExpired && (
                      <button
                        type="button"
                        onClick={() => {
                          setPendingExpired(false);
                          void result.refetch();
                        }}
                      >
                        {t("common.retry")}
                      </button>
                    )}
                    <button type="button" disabled={saving} onClick={() => setSelecting(true)}>
                      {t("template.chooseOther")}
                    </button>
                    <button type="button" disabled={saving} onClick={() => requestSwitch("generic")}>
                      {t("template.useGeneric")}
                    </button>
                  </div>
                </div>
              )}
            </div>

            <div className={s["edit-hint"]}>{locked ? t("result.lockedHint") : t("result.editHint")}</div>
            <ChangeLog jobId={id} groups={(data.template?.groups ?? null) as Group[] | null} variant="link" />

            {Boolean(error) && (
              <p className={s["status-error"]} role="alert">
                {errorMessage(error, t)}
              </p>
            )}
            {expired && (
              <button type="button" className={s["home-btn"]} onClick={() => navigate("/plans")}>
                {t("scan.toPlans")}
              </button>
            )}
          </div>

          <div className={s["action-bar"]}>
            {isGuest && <p className={s["guest-hint"]}>{t("result.guestHint")}</p>}
            {!isGuest && !locked && <p className={s["bar-caption"]}>{t("result.aiCaption")}</p>}
            {locked ? (
              <div className={s["action-buttons"]}>
                <button type="button" className={s["primary-btn"]} onClick={() => navigate(`/scan/jobs/${id}/final`)}>
                  {t("final.title")}
                </button>
              </div>
            ) : (
              <div className={s["action-buttons"]}>
                <button type="button" className={s["reset-btn"]} disabled={!dirty || busy} onClick={() => setConfirmingReset(true)}>
                  {t("result.reset")}
                </button>
                <button type="button" className={s["reset-btn"]} disabled={!dirty || busy} onClick={() => void saveDraft()}>
                  {t("result.saveDraft")}
                </button>
                <button type="button" className={s["primary-btn"]} disabled={busy} onClick={() => void confirm()}>
                  {saving ? <BrandLoading variant="inline" label={t("result.saving")} /> : t("result.continue")}
                </button>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className={s.fatal}>
          <BrandLoading variant="inline" label={t("common.loading")} />
        </div>
      )}

      {toast && (
        <div className={s["template-toast"]} role="status">
          {toast}
        </div>
      )}
      {selecting && (
        <TemplatePanel jobId={id} current={current} onClose={() => setSelecting(false)} onApply={requestSwitch} />
      )}
      {switchTo !== null && (
        <FormDialog title={t("template.saveSwitch")} subtitle={t("template.unsaved")}>
          <div className={fd["fd-actions"]}>
            <button type="button" className={`${fd["fd-btn"]} ${fd.secondary}`} onClick={() => setSwitchTo(null)}>
              {t("common.cancel")}
            </button>
            <button type="button" className={`${fd["fd-btn"]} ${fd.primary}`} onClick={() => void doSwitch(switchTo)}>
              {t("template.saveSwitch")}
            </button>
          </div>
        </FormDialog>
      )}
      {confirmingReset && !locked && (
        <FormDialog title={t("result.resetConfirm")} subtitle={t("result.resetConfirmBody")}>
          <div className={fd["fd-actions"]}>
            <button type="button" className={`${fd["fd-btn"]} ${fd.secondary}`} onClick={() => setConfirmingReset(false)}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className={`${fd["fd-btn"]} ${fd.danger}`}
              onClick={() => {
                setDraft(null); // main resetDraft: back to the last saved result, no request
                setConfirmingReset(false);
              }}
            >
              {t("result.reset")}
            </button>
          </div>
        </FormDialog>
      )}
    </div>
  );
}
