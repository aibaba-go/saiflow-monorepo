import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { BrandLoading } from "../../components/BrandLoading";
import { isMessageKey, useT, type T } from "../../i18n";
import { api, call } from "../../services/api";
import { errorMessage } from "../../services/errors";
import { useCurrentTenant } from "../tenants/useCurrentTenant";
import { cancelJob, rerunJob } from "./api";
import { FormDialog, fd } from "./components/FormDialog";
import { PageHeader } from "./components/PageHeader";
import s from "./ProcessingPage.module.css";
import theme from "./theme.module.css";

export const POLL_MS = 2_000;
export const MATCH_WAIT_MS = 90_000;
const RUNNING = new Set(["QUEUED", "PREPROCESSING", "PROCESSING", "POSTPROCESSING", "CANCEL_REQUESTED"]);

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
    refetchInterval: (q) => (poll && q.state.data?.stage !== "OCR_FAILED" ? POLL_MS : false),
  });
}

const cx = (...n: (string | false | undefined)[]) => n.filter(Boolean).map((k) => s[k as string] ?? k).join(" ");

/** main `ProcessingPage.vue` (FR-SYS-059, 116): upload → OCR → template matching, refreshed
 * every 2 s; VERIFYING goes to the result page, so does 90 s of matching. A failure shows
 * the reason and Rerun here (our spec). Leaving the page leaves the task running. */
export function ProcessingPage() {
  const t = useT();
  const navigate = useNavigate();
  const client = useQueryClient();
  const { id = "" } = useParams();
  const job = useJob(id, true);
  const [error, setError] = useState<unknown>(null);
  const [confirming, setConfirming] = useState(false);
  const [cancelling, setCancelling] = useState(false);
  const matchingSince = useRef<number | null>(null);
  const data = job.data;
  const stage = data?.stage;
  const status = data?.status ?? "QUEUED";

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
    setCancelling(true);
    setError(null);
    try {
      await cancelJob(id);
      await client.invalidateQueries({ queryKey: ["job"] });
    } catch (e) {
      setError(e);
    } finally {
      setCancelling(false);
      setConfirming(false);
    }
  }

  async function rerun() {
    setError(null);
    try {
      const next = await rerunJob(id);
      void client.invalidateQueries({ queryKey: ["usage"] });
      navigate(`/scan/jobs/${next.id}/progress`, { replace: true });
    } catch (e) {
      setError(e);
    }
  }

  const matching = stage === "TEMPLATE_MATCHING";
  const failed = stage === "OCR_FAILED";
  const ocrRunning = RUNNING.has(status);
  const ocrDone = status === "SUCCEEDED" || status === "PARTIAL_SUCCESS";
  const steps = [
    { key: "UPLOAD", done: true, active: false, failed: false },
    { key: "OCR", done: ocrDone, active: ocrRunning, failed },
    { key: "TEMPLATE_MATCHING", done: ocrDone && !matching, active: matching, failed: false },
  ] as const;

  return (
    <div className={`${theme.scan} ${s.processing}`}>
      <PageHeader title={t("processing.title")} onBack={() => navigate("/")} />
      <div className={s.content}>
        {data ? (
          <div className={s["status-card"]}>
            {ocrRunning || matching ? (
              <BrandLoading variant="inline" label={matching ? t("template.matching") : t("processing.recognizing")} />
            ) : (
              <>
                <div className={cx("done-mark", failed && "failed")} />
                <div className={s["status-title"]}>
                  {failed
                    ? status === "CANCELLED"
                      ? t("result.cancelledTitle")
                      : t("job.stage.OCR_FAILED")
                    : t("processing.recognizing")}
                </div>
              </>
            )}
            <div className={s["status-sub"]}>
              {data.file_name} · {t("processing.pagesAll", { n: data.page_count })}
            </div>
            <div className={s.steps}>
              {steps.map((step, i) => (
                <div key={step.key} className={s.step}>
                  <div className={cx("step-dot", step.done && "done", step.active && "active", step.failed && "failed")}>
                    {step.done ? (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M20 6L9 17l-5-5" />
                      </svg>
                    ) : step.failed ? (
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth="3" strokeLinecap="round">
                        <path d="M18 6L6 18M6 6l12 12" />
                      </svg>
                    ) : step.active ? (
                      <span className={s["step-pulse"]} />
                    ) : null}
                  </div>
                  <span className={cx("step-label", (step.done || step.active) && "on", step.failed && "failed")}>
                    {t(`processing.step.${step.key}`)}
                  </span>
                  {i < steps.length - 1 && (
                    <div className={cx("step-line", (steps[i + 1]!.done || steps[i + 1]!.active) && "done")} />
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : job.isError ? (
          <div className={cx("info-box", "error")}>{errorMessage(job.error, t)}</div>
        ) : (
          <div className={s["status-card"]}>
            <BrandLoading variant="inline" label={t("common.loading")} />
          </div>
        )}

        {failed && status === "CANCELLED" && <div role="status">{t("scan.cancelled")}</div>}
        {failed && status !== "CANCELLED" && (
          <div className={cx("info-box", "error")} role="alert">
            <div>{failureText(data?.error_code, t)}</div>
            <div>{t("scan.refunded")}</div>
          </div>
        )}
        <div className={s["info-box"]}>{t("processing.info")}</div>
        {Boolean(error) && <p className={s["status-error"]}>{errorMessage(error, t)}</p>}

        <button type="button" className={s["home-btn"]} onClick={() => navigate("/")}>
          {t("processing.backHome")}
        </button>
        {failed ? (
          <button type="button" className={s["cancel-btn"]} onClick={() => void rerun()}>
            {t("scan.rerun")}
          </button>
        ) : data && ocrRunning ? (
          <button type="button" className={s["cancel-btn"]} disabled={cancelling} onClick={() => setConfirming(true)}>
            {t("processing.cancelTask")}
          </button>
        ) : null}
      </div>

      {confirming && data && ocrRunning && (
        <FormDialog title={t("processing.cancelConfirm")} subtitle={t("processing.cancelConfirmBody")}>
          <div className={fd["fd-actions"]}>
            <button type="button" className={`${fd["fd-btn"]} ${fd.secondary}`} disabled={cancelling} onClick={() => setConfirming(false)}>
              {t("processing.keepRunning")}
            </button>
            <button type="button" className={`${fd["fd-btn"]} ${fd.danger}`} disabled={cancelling} onClick={() => void cancel()}>
              {t("processing.cancelTask")}
            </button>
          </div>
        </FormDialog>
      )}
    </div>
  );
}
