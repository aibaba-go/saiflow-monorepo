import { useQueries } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { BrandLoading } from "../../components/BrandLoading";
import { usePageUrl } from "../../components/OriginalPreview";
import { useT } from "../../i18n";
import { errorMessage, type ApiError } from "../../services/errors";
import { useCurrentTenant } from "../tenants/useCurrentTenant";
import { getFile } from "./api";
import { ImageViewer } from "./components/ImageViewer";
import { PageHeader } from "./components/PageHeader";
import s from "./ConfirmPage.module.css";
import { useCreateJobs } from "./jobs";
import theme from "./theme.module.css";

/** "PDF", "PNG"…: the extension under the file mark (prototype .file-icon). */
function ext(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot + 1, dot + 5).toUpperCase() : "";
}

/** main `ConfirmPage.vue` (FR-SYS-058, 112): preview the chosen Pending files one by one,
 * then start them in order with one tap. A second tap after a failure starts only the rest
 * (the same idempotency keys, AC-058-03). Quota and plan failures keep our wording and the
 * Plans entry (A5). */
export function ConfirmPage() {
  const t = useT();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { tenant } = useCurrentTenant();
  const [openedIn] = useState(() => tenant?.tenant_id ?? null);
  const ids = useMemo(
    () => [...new Set((params.get("ids") ?? "").split(",").filter(Boolean))],
    [params],
  );
  const files = useQueries({
    queries: ids.map((id) => ({
      queryKey: ["file", openedIn, id],
      queryFn: () => getFile(id),
      retry: false,
      staleTime: 60_000,
    })),
  });
  const create = useCreateJobs();
  const [index, setIndex] = useState(0);
  const [viewer, setViewer] = useState(false);
  const [started, setStarted] = useState<Record<string, string>>({}); // file id → job id
  const [error, setError] = useState<ApiError | null>(null);

  const contextChanged = (tenant?.tenant_id ?? null) !== openedIn;
  const multiple = ids.length > 1;
  const loading = files.some((q) => q.isPending);
  const unavailable = files.some((q) => q.isError || (q.data && q.data.status !== "READY"));
  const current = files[index]?.data ?? null;
  const remaining = ids.filter((id) => !started[id]);
  const preview = usePageUrl(current?.id ?? "", 1);

  async function start() {
    if (create.pending || contextChanged || loading || unavailable) return;
    setError(null);
    const queue = files.map((q) => q.data).filter((f) => f && !started[f.id]) as NonNullable<(typeof files)[number]["data"]>[];
    const result = await create.run(queue);
    const now = { ...started };
    for (const job of result.jobs) now[job.file_id] = job.id;
    setStarted(now);
    if (result.error) {
      setError(result.error);
      return;
    }
    const first = result.jobs[0];
    if (!multiple && first) navigate(`/scan/jobs/${first.id}/progress`, { replace: true });
    else navigate("/", { replace: true }); // main: started files show in Recent tasks
  }

  const startLabel = !multiple
    ? t("confirm.start")
    : remaining.length === 1
      ? t("confirm.startOne")
      : t("confirm.startMany", { n: remaining.length });
  const startedCount = ids.length - remaining.length;
  const pagesText = (n: number) => (n === 1 ? t("home.pending.pageOne") : t("home.pending.pageMany", { n }));
  // the pages this tap will start (the quota it uses), from the files themselves
  const totalPages = files.reduce((sum, q) => (q.data && !started[q.data.id] ? sum + (q.data.page_count || 1) : sum), 0);
  const quota = error?.code === "quota_exceeded";
  const expired = error?.code === "plan_expired";

  return (
    <div className={`${theme.scan} ${s.confirm}`}>
      <PageHeader title={t("confirm.title")} onBack={() => navigate("/")} />
      <div className={s.content}>
        {multiple && <p className={s["review-context"]}>{t("confirm.reviewSelected")}</p>}
        {contextChanged && (
          <p className={s["status-error"]} role="alert">
            {t("confirm.contextChanged")}
          </p>
        )}
        {quota && (
          <p className={s["status-error"]} role="alert">
            {t("scan.quotaLeft", { n: Number(error.details?.available ?? 0) })}
          </p>
        )}
        {error && !quota && (
          <p className={s["status-error"]} role="alert">
            {errorMessage(error, t)}
            {startedCount > 0 && ` ${t("confirm.partialStarted", { n: startedCount, total: ids.length })}`}
          </p>
        )}
        {expired && (
          <button type="button" className={s["primary-btn"]} onClick={() => navigate("/plans")}>
            {t("scan.toPlans")}
          </button>
        )}
        {current ? (
          <>
            {/* prototype .file-card: the file, where it sits in the selection, its pages */}
            <div className={s["file-summary"]}>
              <span className={s["file-icon"]} aria-hidden>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z" />
                  <path d="M14 3v5h5M9 13h6M9 17h4" />
                </svg>
                <span className={s["file-ext"]}>{ext(current.original_name)}</span>
              </span>
              <div className={s["file-text"]}>
                <div className={s["file-name"]}>{current.original_name}</div>
                <div className={s["file-meta"]}>
                  {t("confirm.fileInfo", { n: index + 1, total: ids.length, pages: pagesText(current.page_count || 1) })}
                </div>
              </div>
              {multiple && (
                <div className={[s["file-state"], started[current.id] && s.started].filter(Boolean).join(" ")}>
                  {started[current.id] ? t("confirm.started") : t("confirm.notStarted")}
                </div>
              )}
            </div>
            <button type="button" className={s["preview-wrap"]} aria-label={t("result.tapZoom")} onClick={() => setViewer(true)}>
              {preview ? <img className={s.preview} src={preview} alt={current.original_name} /> : <span className={s.preview} />}
              <div className={s["page-badge"]}>{t("confirm.pageOf", { n: 1, total: current.page_count || 1 })}</div>
              <span className={s["zoom-badge"]}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
                  <circle cx="11" cy="11" r="7" />
                  <path d="M20 20l-3.5-3.5M8 11h6M11 8v6" />
                </svg>
              </span>
            </button>
            {viewer && (
              <ImageViewer fileId={current.id} pages={current.page_count || 1} alt={current.original_name} onClose={() => setViewer(false)} />
            )}
            <p className={s.notice}>{t("confirm.notice")}</p>
          </>
        ) : (
          loading && <BrandLoading variant="page" label={t("common.loading")} />
        )}
        {multiple && (
          <div className={s["file-switch"]}>
            <button type="button" className={s["switch-btn"]} aria-label={t("confirm.prevFile")} disabled={create.pending || index === 0} onClick={() => setIndex(index - 1)}>
              ‹
            </button>
            <span className={s["switch-position"]}>{t("confirm.filePosition", { n: index + 1, total: ids.length })}</span>
            <button type="button" className={s["switch-btn"]} aria-label={t("confirm.nextFile")} disabled={create.pending || index >= ids.length - 1} onClick={() => setIndex(index + 1)}>
              ›
            </button>
          </div>
        )}
        {unavailable && (
          <p className={s["status-error"]} role="alert">
            {t("confirm.unavailable")}
          </p>
        )}
      </div>
      {ids.length > 0 && (
        <div className={s["action-bar"]}>
          {totalPages > 0 && <p className={s["bar-caption"]}>{t("confirm.pagesCaption", { pages: pagesText(totalPages) })}</p>}
          <button
            type="button"
            className={s["primary-btn"]}
            disabled={create.pending || contextChanged || loading || unavailable || remaining.length === 0}
            onClick={() => void start()}
          >
            {create.pending ? <BrandLoading variant="inline" label={t("common.loading")} /> : startLabel}
          </button>
        </div>
      )}
    </div>
  );
}
