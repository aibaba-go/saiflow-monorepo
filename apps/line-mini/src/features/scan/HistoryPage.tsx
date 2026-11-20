import { useInfiniteQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { BrandLoading } from "../../components/BrandLoading";
import { useT, type MessageKey } from "../../i18n";
import { errorMessage } from "../../services/errors";
import { formatBangkokDate } from "../../utils/format";
import { useCurrentTenant } from "../tenants/useCurrentTenant";
import { listJobs, type JobOut } from "./api";
import { JobListItem } from "./components/JobListItem";
import s from "./HistoryPage.module.css";
import kit from "./kit.module.css";
import theme from "./theme.module.css";

export const PAGE_SIZE = 20;
const FILTERS = [
  "ALL",
  "OCR_PROCESSING",
  "OCR_FAILED",
  "TEMPLATE_MATCHING",
  "VERIFYING",
  "PENDING_REVIEW",
  "CONFIRMED",
] as const;
type Filter = (typeof FILTERS)[number];

/** Where a row opens (AC-FR-SYS-108-01): progress while recognising, matching or failed;
 * the result page to verify; the final result once confirmed. */
export function jobTarget(job: Pick<JobOut, "id" | "stage">): string {
  if (job.stage === "VERIFYING") return `/scan/jobs/${job.id}/result`;
  if (job.stage === "CONFIRMED" || job.stage === "PENDING_REVIEW") return `/scan/jobs/${job.id}/final`;
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
  const total = jobs.data?.pages[0]?.total ?? rows.length;
  // prototype .list-heading: the rows under their Bangkok date, newest first
  const groups: { date: string; rows: JobOut[] }[] = [];
  for (const job of rows) {
    const date = formatBangkokDate(job.created_at);
    const last = groups[groups.length - 1];
    if (last?.date === date) last.rows.push(job);
    else groups.push({ date, rows: [job] });
  }
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
      <header className={kit["tab-top"]}>
        <span className={kit["tab-eyebrow"]} aria-hidden="true">SAIFLOW</span>
        <h1 className={kit["tab-title"]}>{t("history.title")}</h1>
        <span className={kit["tab-end"]} />
      </header>
      <div className={s.content}>
        <div className={s["title-block"]}>
          <span className={kit.eyebrow}>{t("history.eyebrow")}</span>
          <h2>{t("history.tagline")}</h2>
          <p>{t("history.scope", { workspace: tenantLabel })}</p>
        </div>
        <div className={s["search-card"]}>
          <svg className={s["search-icon"]} aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round">
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
            {groups.map((group, i) => (
              <section key={group.date} className={s.group} aria-label={group.date}>
                <div className={s["list-heading"]}>
                  <span>{group.date}</span>
                  {i === 0 && <span>{t("history.count", { n: total })}</span>}
                </div>
                <div className={s["task-list"]}>
                  {group.rows.map((job) => (
                    <JobListItem key={job.id} job={job} onOpen={(j) => navigate(jobTarget(j))} />
                  ))}
                </div>
              </section>
            ))}
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
