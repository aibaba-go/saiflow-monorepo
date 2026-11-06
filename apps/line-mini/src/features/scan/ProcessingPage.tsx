import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, NavBar, Steps } from "antd-mobile";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { BrandLoading } from "../../components/BrandLoading";
import { ErrorText } from "../../components/ErrorText";
import { isMessageKey, useT, type T } from "../../i18n";
import { api, call } from "../../services/api";
import { useCurrentTenant } from "../tenants/useCurrentTenant";
import { confirmAction } from "../../utils/confirm";

export const POLL_MS = 2_000;
export const MATCH_WAIT_MS = 90_000;

/** The localized reason for an OCR or conversion failure. */
export function failureText(code: string | null | undefined, t: T): string {
  const key = `ocrerr.${code ?? ""}`;
  return isMessageKey(key) ? t(key) : t("ocrerr.unknown");
}

export function useJob(id: string, poll: boolean) {
  const { tenant } = useCurrentTenant();
  return useQuery({
    queryKey: ["job", tenant?.tenant_id, id],
    queryFn: () => call(api.GET("/api/v1/ocr/jobs/{job_id}", { params: { path: { job_id: id } } })),
    // Poll until the job leaves recognition and matching (or failed).
    refetchInterval: (q) => (poll && q.state.data?.stage !== "OCR_FAILED" ? POLL_MS : false),
  });
}

/** Upload → recognition → template matching, refreshed every 2 s (FR-SYS-059). VERIFYING
 * goes to the result page; so does 90 s of matching, where the result page shows it. */
export function ProcessingPage() {
  const t = useT();
  const navigate = useNavigate();
  const client = useQueryClient();
  const { id = "" } = useParams();
  const job = useJob(id, true);
  const [error, setError] = useState<unknown>(null);
  const matchingSince = useRef<number | null>(null);
  const stage = job.data?.stage;
  const status = job.data?.status;

  useEffect(() => {
    if (!stage) return;
    if (stage === "VERIFYING" || stage === "CONFIRMED") {
      navigate(`/scan/jobs/${id}/result`, { replace: true });
      return;
    }
    if (stage !== "TEMPLATE_MATCHING") return;
    matchingSince.current ??= Date.now();
    const wait = MATCH_WAIT_MS - (Date.now() - matchingSince.current);
    const timer = setTimeout(() => navigate(`/scan/jobs/${id}/result`, { replace: true }), Math.max(0, wait));
    return () => clearTimeout(timer);
  }, [stage, id, navigate]);

  async function cancel() {
    if (!(await confirmAction(t, t("scan.cancelTitle")))) return;
    setError(null);
    try {
      await call(api.POST("/api/v1/ocr/jobs/{job_id}/cancel", { params: { path: { job_id: id } } }));
      await client.invalidateQueries({ queryKey: ["job"] });
    } catch (e) {
      setError(e);
    }
  }

  async function rerun() {
    setError(null);
    try {
      const next = await call(api.POST("/api/v1/ocr/jobs/{job_id}/rerun", { params: { path: { job_id: id } } }));
      void client.invalidateQueries({ queryKey: ["usage"] });
      navigate(`/scan/jobs/${next.id}/progress`, { replace: true });
    } catch (e) {
      setError(e);
    }
  }

  const current = stage === "TEMPLATE_MATCHING" ? 2 : 1;
  const failed = stage === "OCR_FAILED";
  return (
    <div className="page">
      <NavBar onBack={() => navigate("/")}>{t("scan.progressTitle")}</NavBar>
      {job.isPending && <BrandLoading variant="inline" label={t("common.loading")} />}
      {job.isError && <ErrorText error={job.error} />}
      {job.data && (
        <>
          <div className="section__label">
            {job.data.file_name} · {t("scan.pagesOf", { n: job.data.page_count })}
          </div>
          <Steps direction="vertical" current={current}>
            <Steps.Step title={t("scan.stepUpload")} status="finish" />
            <Steps.Step title={t("scan.stepOcr")} status={failed ? "error" : current > 1 ? "finish" : "process"} />
            <Steps.Step title={t("scan.stepMatch")} status={current === 2 ? "process" : "wait"} />
          </Steps>
          {failed && status === "CANCELLED" && <div role="status">{t("scan.cancelled")}</div>}
          {failed && status !== "CANCELLED" && (
            <div role="alert">
              <div className="form__title">{t("scan.failedTitle")}</div>
              <div className="field-error">{failureText(job.data.error_code, t)}</div>
              <div className="usage__hint">{t("scan.refunded")}</div>
            </div>
          )}
          {failed && (
            <Button color="primary" onClick={() => void rerun()}>
              {t("scan.rerun")}
            </Button>
          )}
          {stage === "OCR_PROCESSING" && <Button onClick={() => void cancel()}>{t("scan.cancel")}</Button>}
          <ErrorText error={error} />
        </>
      )}
    </div>
  );
}
