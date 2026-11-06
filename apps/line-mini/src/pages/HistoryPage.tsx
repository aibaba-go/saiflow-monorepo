import { useInfiniteQuery } from "@tanstack/react-query";
import { Button, CapsuleTabs, List, Tag } from "antd-mobile";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";

import { ErrorText } from "../components/ErrorText";
import { useT, type MessageKey } from "../i18n";
import { api, call } from "../services/api";
import { useCurrentTenant } from "../features/tenants/useCurrentTenant";
import type { JobOut } from "../features/scan/jobs";
import { formatBangkokDateTime } from "../utils/format";

export const PAGE_SIZE = 20;
const FILTERS = ["all", "OCR_PROCESSING", "OCR_FAILED", "VERIFYING", "CONFIRMED"] as const;
type Filter = (typeof FILTERS)[number];

const STAGE_LABEL: Record<string, MessageKey> = {
  OCR_PROCESSING: "history.stage.OCR_PROCESSING",
  OCR_FAILED: "history.stage.OCR_FAILED",
  TEMPLATE_MATCHING: "history.stage.TEMPLATE_MATCHING",
  VERIFYING: "history.stage.VERIFYING",
  CONFIRMED: "history.stage.CONFIRMED",
};
const FILTER_LABEL: Record<Filter, MessageKey> = {
  all: "history.filter.all",
  OCR_PROCESSING: "history.stage.OCR_PROCESSING",
  OCR_FAILED: "history.stage.OCR_FAILED",
  VERIFYING: "history.stage.VERIFYING",
  CONFIRMED: "history.stage.CONFIRMED",
};

/** Where a row opens (AC-FR-SYS-108-01): progress while recognising, matching or failed;
 * the result page to verify; the final result once confirmed. */
export function jobTarget(job: Pick<JobOut, "id" | "stage">): string {
  if (job.stage === "VERIFYING") return `/scan/jobs/${job.id}/result`;
  if (job.stage === "CONFIRMED") return `/scan/jobs/${job.id}/final`;
  return `/scan/jobs/${job.id}/progress`;
}

/** The current tenant's visible jobs, newest first, 20 at a time (FR-SYS-108). The tenant is
 * part of the key, so switching tenant starts a fresh list. */
export function HistoryPage() {
  const t = useT();
  const navigate = useNavigate();
  const { tenant } = useCurrentTenant();
  const [filter, setFilter] = useState<Filter>("all");
  const jobs = useInfiniteQuery({
    queryKey: ["jobs", tenant?.tenant_id, filter],
    initialPageParam: 1,
    queryFn: ({ pageParam }) =>
      call(
        api.GET("/api/v1/ocr/jobs", {
          params: {
            query: {
              page: String(pageParam),
              page_size: String(PAGE_SIZE),
              ...(filter === "all" ? {} : { stage: filter }),
            },
          },
        }),
      ),
    getNextPageParam: (last) => (last.page * last.page_size < last.total ? last.page + 1 : undefined),
    enabled: tenant !== null,
  });
  const rows = jobs.data?.pages.flatMap((p) => p.items) ?? [];
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = jobs;
  // Load the next page when the end of the list scrolls into view.
  useEffect(() => {
    const el = sentinel.current;
    if (!el || !hasNextPage || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting) && !isFetchingNextPage) void fetchNextPage();
    });
    io.observe(el);
    return () => io.disconnect();
  }, [hasNextPage, isFetchingNextPage, fetchNextPage]);

  return (
    <div className="page">
      <h1 className="page__title">{t("nav.history")}</h1>
      <CapsuleTabs activeKey={filter} onChange={(key) => setFilter(key as Filter)}>
        {FILTERS.map((f) => (
          <CapsuleTabs.Tab key={f} title={t(FILTER_LABEL[f])} />
        ))}
      </CapsuleTabs>
      {jobs.isError && <ErrorText error={jobs.error} />}
      {jobs.isSuccess && !rows.length && <div className="usage__hint">{t("history.empty")}</div>}
      <List>
        {rows.map((job) => (
          <List.Item
            key={job.id}
            data-job={job.id}
            onClick={() => navigate(jobTarget(job))}
            description={`${job.template_name ?? t("history.noTemplate")} · ${formatBangkokDateTime(job.created_at)}`}
            extra={<Tag color={job.stage === "OCR_FAILED" ? "danger" : job.stage === "CONFIRMED" ? "success" : "primary"}>{t(STAGE_LABEL[job.stage] ?? "history.stage.OCR_PROCESSING")}</Tag>}
          >
            {job.file_name}
          </List.Item>
        ))}
      </List>
      <div ref={sentinel} className="history__end">
        {hasNextPage ? (
          <Button size="small" fill="none" loading={isFetchingNextPage} onClick={() => void fetchNextPage()}>
            {t("history.more")}
          </Button>
        ) : rows.length ? (
          <span className="usage__hint">{t("history.end")}</span>
        ) : null}
      </div>
    </div>
  );
}
