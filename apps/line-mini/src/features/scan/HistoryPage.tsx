import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { BrandLoading } from "../../components/BrandLoading";
import { useT, type MessageKey } from "../../i18n";
import { errorMessage } from "../../services/errors";
import { useCurrentTenant } from "../tenants/useCurrentTenant";
import { listJobs, type JobOut } from "./api";
import { JobListItem } from "./components/JobListItem";
import s from "./HistoryPage.module.css";
import theme from "./theme.module.css";

export const PAGE_SIZE = 20;
const FILTERS = ["ALL", "OCR_PROCESSING", "OCR_FAILED", "TEMPLATE_MATCHING", "VERIFYING", "CONFIRMED"] as const;
type Filter = (typeof FILTERS)[number];

/** Where a row opens (AC-FR-SYS-108-01): progress while recognising, matching or failed;
 * the result page to verify; the final result once confirmed. */
export function jobTarget(job: Pick<JobOut, "id" | "stage">): string {
  if (job.stage === "VERIFYING") return `/scan/jobs/${job.id}/result`;
  if (job.stage === "CONFIRMED") return `/scan/jobs/${job.id}/final`;
  return `/scan/jobs/${job.id}/progress`;
}

const filterLabel = (f: Filter): MessageKey =>
  f === "ALL" ? "history.filter.all" : f === "CONFIRMED" ? "job.review.CONFIRMED" : (`job.stage.${f}` as MessageKey);

/** main `HistoryPage.vue` (FR-SYS-108, 117): file-name search (300 ms after typing stops)
 * with the stage chips, newest first, 20 at a time as the list end scrolls in. The tenant
 * is part of the key, so switching tenant starts a fresh list. */
export function HistoryPage() {
  const t = useT();
  const navigate = useNavigate();
  const { tenant } = useCurrentTenant();
  const [filter, setFilter] = useState<Filter>("ALL");
  const [keyword, setKeyword] = useState("");
  const [q, setQ] = useState("");
  useEffect(() => {
    const timer = setTimeout(() => setQ(keyword.trim()), 300);
    return () => clearTimeout(timer);
  }, [keyword]);
  const jobs = useInfiniteQuery({
    queryKey: ["jobs", tenant?.tenant_id, filter, q],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      listJobs({ page: pageParam, pageSize: PAGE_SIZE, stage: filter === "ALL" ? undefined : filter, q: q || undefined }),
    getNextPageParam: (last) => (last.page * last.page_size < last.total ? last.page + 1 : undefined),
    enabled: tenant !== null,
  });
  const rows = jobs.data?.pages.flatMap((p) => p.items) ?? [];
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = jobs;
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  const tenantLabel = tenant?.kind === "organization" ? tenant.name || t("my.company") : t("home.workspacePersonal");
  return (
    <div className={`${theme.scan} ${s.history}`}>
      <header className={s["history-header"]}>
        <h1>{t("history.title")}</h1>
        <div className={s["ws-pill"]}>{tenantLabel}</div>
      </header>
      <div className={s.content}>
        <div className={s["search-card"]}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#99A1B0" strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" />
            <path d="M21 21l-4.3-4.3" />
          </svg>
          <input
            className={s["search-input"]}
            aria-label={t("history.searchPlaceholder")}
            placeholder={t("history.searchPlaceholder")}
            value={keyword}
            onChange={(e) => setKeyword(e.target.value)}
          />
        </div>
        <div className={s["filter-row"]}>
          {FILTERS.map((f) => (
            <button
              type="button"
              key={f}
              className={[s["filter-chip"], filter === f && s.active].filter(Boolean).join(" ")}
              aria-pressed={filter === f}
              onClick={() => setFilter(f)}
            >
              {t(filterLabel(f))}
            </button>
          ))}
        </div>
        {jobs.isError && <p className={s["status-error"]}>{errorMessage(jobs.error, t)}</p>}
        {jobs.isPending ? (
          <BrandLoading variant="page" label={t("common.loading")} />
        ) : !rows.length ? (
          <div className={s["status-line"]}>{t("history.empty")}</div>
        ) : (
          <>
            <div className={s["task-list"]}>
              {rows.map((job) => (
                <JobListItem key={job.id} job={job} onOpen={(j) => navigate(jobTarget(j))} />
              ))}
            </div>
            <div ref={sentinel} className={s["list-foot"]}>
              {hasNextPage ? (
                isFetchingNextPage ? (
                  <BrandLoading variant="inline" label={t("history.loadingMore")} />
                ) : (
                  <button type="button" onClick={() => void fetchNextPage()}>
                    {t("history.more")}
                  </button>
                )
              ) : (
                <span>{t("history.noMore")}</span>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}
