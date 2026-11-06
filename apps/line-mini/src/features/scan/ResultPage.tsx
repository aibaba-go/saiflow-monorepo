import type { components } from "@saiflow/api-client";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, NavBar, Toast } from "antd-mobile";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { BrandLoading } from "../../components/BrandLoading";
import { ErrorText } from "../../components/ErrorText";
import { OriginalPreview } from "../../components/OriginalPreview";
import { useT } from "../../i18n";
import { api, call } from "../../services/api";
import { ApiError } from "../../services/errors";
import { useSession } from "../../stores/session";
import { confirmResult, scrollToField, wantsConfirm } from "./confirm";
import { useCurrentTenant } from "../tenants/useCurrentTenant";
import { failureText, POLL_MS, useJob } from "./ProcessingPage";
import { StructuredEditor } from "./StructuredEditor";
import type { Group, Json } from "./structured";
import { TemplatePicker } from "./TemplatePicker";

export type ResultOut = components["schemas"]["ResultOut"];
const RUNNING = new Set(["PENDING", "MATCHING", "CONVERTING"]);

export function useResult(id: string) {
  const { tenant } = useCurrentTenant();
  return useQuery({
    queryKey: ["result", tenant?.tenant_id, id],
    queryFn: () => call(api.GET("/api/v1/ocr/jobs/{job_id}/result", { params: { path: { job_id: id } } })),
    refetchInterval: (q) => (q.state.data?.mapping && RUNNING.has(q.state.data.mapping.status) ? POLL_MS : false),
  });
}

/** The original above, the fields below in the template's order; save a draft or change
 * the template (FR-SYS-105). A version conflict reloads the latest version (AC-105-03). */
export function ResultPage() {
  const t = useT();
  const navigate = useNavigate();
  const client = useQueryClient();
  const { id = "" } = useParams();
  const job = useJob(id, false);
  const result = useResult(id);
  const [draft, setDraft] = useState<{ base: number; value: Json } | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [picker, setPicker] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [missing, setMissing] = useState<string[]>([]);
  const [expired, setExpired] = useState(false);
  const me = useSession((s) => s.me);
  const autoConfirm = useRef(false);
  const data = result.data;
  // An edit is kept only against the version it was made on.
  const dirty = draft !== null && data !== undefined && draft.base === data.version;
  const value = (dirty ? draft.value : (data?.structured ?? {})) as Json;

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
      const saved = await call(
        api.PATCH("/api/v1/ocr/jobs/{job_id}/result", {
          params: { path: { job_id: id } },
          body: { expected_version: data.version, structured: draft.value, confirm: false },
        }),
      );
      client.setQueriesData({ queryKey: ["result"] }, (old: ResultOut | undefined) =>
        old && old.version === data.version ? saved : old,
      );
      setDraft(null);
      Toast.show({ content: t("scan.saved") });
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

  /** Save, then confirm (FR-SYS-106): login first for a guest, the fields marked and the
   * first one scrolled to on 422, the plans page offered on 402. */
  async function confirm() {
    setExpired(false);
    const saved = await saveDraft();
    if (!saved) return;
    setConfirming(true);
    try {
      const out = await confirmResult(id, saved.version, (saved.structured ?? {}) as Json);
      if (out.kind === "confirmed") {
        void client.invalidateQueries({ queryKey: ["jobs"] });
        void client.invalidateQueries({ queryKey: ["job"] });
        client.setQueriesData({ queryKey: ["result"] }, () => out.result);
        navigate(`/scan/jobs/${id}/final`, { replace: true });
      } else if (out.kind === "missing") {
        setMissing(out.paths);
        if (out.paths[0]) setTimeout(() => scrollToField(out.paths[0]!), 0);
      } else if (out.kind === "error") {
        if (out.error.code === "plan_expired") setExpired(true);
        setError(out.error);
      }
    } finally {
      setConfirming(false);
    }
  }

  // Back from LINE login or registration with a confirm waiting (AC-FR-SYS-106-01).
  const registered = me?.kind === "user" && me.registered;
  useEffect(() => {
    if (!data || !registered || autoConfirm.current || !wantsConfirm(id)) return;
    autoConfirm.current = true;
    void confirm();
  });

  const mapping = data?.mapping;
  const running = mapping ? RUNNING.has(mapping.status) : false;
  const groups = (data?.template?.groups ?? null) as Group[] | null;
  return (
    <div className="page">
      <NavBar onBack={() => navigate("/")}>{data?.template?.name ?? t("scan.resultTitle")}</NavBar>
      {job.data && (
        <OriginalPreview fileId={job.data.file_id} fileName={job.data.file_name} pageCount={job.data.page_count} />
      )}
      {result.isPending && <BrandLoading variant="inline" label={t("common.loading")} />}
      {result.isError && <ErrorText error={result.error} />}
      {notice && <div role="alert" className="field-error">{notice}</div>}
      {running && <div role="status">{t("scan.matching")}</div>}
      {mapping?.status === "FAILED" && (
        <div role="alert" className="field-error">
          {t("scan.mappingFailed", { reason: failureText(mapping.error, t) })}
        </div>
      )}
      {data && data.missing_required.length > 0 && (
        <div className="field-error">{t("scan.missing", { n: data.missing_required.length })}</div>
      )}
      {data && (
        <StructuredEditor
          value={value}
          groups={groups}
          missing={new Set([...data.missing_required, ...missing])}
          onChange={(next) => setDraft({ base: data.version, value: next })}
        />
      )}
      <ErrorText error={error} />
      {expired && <Button onClick={() => navigate("/plans")}>{t("scan.toPlans")}</Button>}
      {data?.confirmed && (
        <Button onClick={() => navigate(`/scan/jobs/${id}/final`)}>{t("scan.finalTitle")}</Button>
      )}
      {data && !data.confirmed && (
        <div className="result__actions">
          <Button loading={saving} disabled={!dirty} onClick={() => void saveDraft()}>
            {t("scan.saveDraft")}
          </Button>
          <Button disabled={running} onClick={() => setPicker(true)}>
            {t("scan.changeTemplate")}
          </Button>
          <Button color="primary" loading={confirming} disabled={running || saving} onClick={() => void confirm()}>
            {t("common.confirm")}
          </Button>
        </div>
      )}
      <TemplatePicker
        jobId={id}
        open={picker}
        onClose={() => setPicker(false)}
        onBeforeSwitch={async () => (await saveDraft()) !== null}
        onSwitched={() => {
          void client.invalidateQueries({ queryKey: ["template-options", id] });
          void reload();
        }}
      />
    </div>
  );
}
