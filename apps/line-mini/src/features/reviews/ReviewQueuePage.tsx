import { ArrowRight } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { BrandLoading } from "../../components/BrandLoading";
import { useT } from "../../i18n";
import { errorMessage } from "../../services/errors";
import { formatBangkokDateTime, formatCount } from "../../utils/format";
import { DocThumb } from "../scan/components/JobListItem";
import { PageHeader } from "../scan/components/PageHeader";
import { StatusChip } from "../scan/components/StatusChip";
import kit from "../scan/kit.module.css";
import theme from "../scan/theme.module.css";
import { useCurrentTenant } from "../tenants/useCurrentTenant";
import { heldLevels, type Level, useReviewQueue, useReviewSummary } from "./api";
import s from "./reviews.module.css";

/** The review queue (FR-SYS-120) in the prototype layout (FR-SYS-138): the title block, one
 * tab per level the user holds with its count from the summary, newest first, more on
 * scrolling. Each card shows the confirmer and the stage; items the user may not decide say
 * why and open read-only. */
export function ReviewQueuePage() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const { tenant } = useCurrentTenant();
  const levels = heldLevels(tenant);
  // a message from the detail page: approved, returned, or already handled by someone else
  const notice = (location.state as { notice?: string } | null)?.notice;
  const [toast, setToast] = useState<string | null>(
    notice === "approved" ? "review.approved" : notice === "returned" ? "review.returned" : notice === "handled" ? "review.handled" : null,
  );
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(timer);
  }, [toast]);
  const [picked, setPicked] = useState<Level | null>(null);
  const level = picked && levels.includes(picked) ? picked : (levels[0] ?? 1);
  const queue = useReviewQueue(level);
  const summary = useReviewSummary(levels.length > 0);
  // pages are offsets: items others cleared meanwhile can shift a row into the next page
  const rows = (queue.data?.pages.flatMap((p) => p.items) ?? []).filter(
    (item, i, all) => all.findIndex((x) => x.job_id === item.job_id) === i,
  );
  const sentinel = useRef<HTMLDivElement>(null);
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = queue;
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
    <div className={`${theme.scan} ${s.page}`}>
      <PageHeader title={t("review.title")} onBack={() => navigate("/")} />
      <div className={s.content}>
        <div className={kit["title-block"]}>
          <span className={kit.eyebrow}>{t("review.eyebrow")}</span>
          <h2>{t("review.tagline")}</h2>
          <p>{t("review.scope")}</p>
        </div>
        {levels.length === 0 ? (
          <div className={s["status-line"]}>{t("review.noPermission")}</div>
        ) : (
          <>
            <div className={s.tabs} role="tablist">
              {levels.map((l) => {
                const count = l === 2 ? summary.data?.l2 : summary.data?.l1;
                return (
                  <button
                    key={l}
                    type="button"
                    role="tab"
                    aria-selected={l === level}
                    className={`${s.tab} ${l === level ? s.active : ""}`}
                    onClick={() => setPicked(l)}
                  >
                    {t(l === 2 ? "review.level2" : "review.level1")}
                    {count != null && ` ${formatCount(count)}`}
                  </button>
                );
              })}
            </div>
            {queue.isPending ? (
              <BrandLoading variant="inline" label={t("common.loading")} />
            ) : queue.isError ? (
              <p className={s.error}>{errorMessage(queue.error, t)}</p>
            ) : !rows.length ? (
              <div className={s["status-line"]}>{t("review.empty")}</div>
            ) : (
              <>
                {rows.map((item) => (
                  <button
                    key={item.job_id}
                    type="button"
                    className={s.item}
                    onClick={() => navigate(`/reviews/${item.job_id}`)}
                  >
                    <span className={s["item-head"]}>
                      <DocThumb name={item.file_name} />
                      <span className={s["item-body"]}>
                        <span className={s["item-name"]}>{item.file_name}</span>
                        <span className={s.meta}>{item.template_name ?? t("template.generic")}</span>
                      </span>
                    </span>
                    <span className={kit["detail-row"]}>
                      <span>{t("review.confirmer")}</span>
                      <strong>
                        {item.confirmed_by_name ?? "-"}
                        {item.confirmed_at ? ` · ${formatBangkokDateTime(item.confirmed_at)}` : ""}
                      </strong>
                    </span>
                    <span className={kit["detail-row"]}>
                      <span>{t("review.stageLabel")}</span>
                      <StatusChip stage="PENDING_REVIEW" level={level} />
                    </span>
                    {item.block_reason && (
                      <span className={s.blocked}>
                        {t(
                          item.block_reason === "did_level1"
                            ? "review.blocked.did_level1"
                            : "review.blocked.own_confirmation",
                        )}
                      </span>
                    )}
                    <span className={`${kit.btn} ${kit.wide} ${item.block_reason ? "" : kit.soft} ${s["item-open"]}`}>
                      {t(item.block_reason ? "review.openReadOnly" : "review.open")}
                      <ArrowRight size={16} strokeWidth={1.75} aria-hidden="true" />
                    </span>
                  </button>
                ))}
                <div ref={sentinel} className={s.foot}>
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
          </>
        )}
      </div>
      {toast && (
        <div className={s.toast} role="status">
          {t(toast as "review.handled")}
        </div>
      )}
    </div>
  );
}
