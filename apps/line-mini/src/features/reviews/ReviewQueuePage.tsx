import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import { BrandLoading } from "../../components/BrandLoading";
import { useT } from "../../i18n";
import { errorMessage } from "../../services/errors";
import { formatBangkokDateTime } from "../../utils/format";
import { PageHeader } from "../scan/components/PageHeader";
import theme from "../scan/theme.module.css";
import { useCurrentTenant } from "../tenants/useCurrentTenant";
import { heldLevels, type Level, useReviewQueue } from "./api";
import s from "./reviews.module.css";

/** The review queue (FR-SYS-120): one tab per level the user holds, newest first, more on
 * scrolling. Items the user may not decide say why and open read-only. */
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
  const rows = queue.data?.pages.flatMap((p) => p.items) ?? [];
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
        {levels.length === 0 ? (
          <div className={s["status-line"]}>{t("review.noPermission")}</div>
        ) : (
          <>
            <div className={s.tabs} role="tablist">
              {levels.map((l) => (
                <button
                  key={l}
                  type="button"
                  role="tab"
                  aria-selected={l === level}
                  className={`${s.tab} ${l === level ? s.active : ""}`}
                  onClick={() => setPicked(l)}
                >
                  {t(l === 2 ? "review.level2" : "review.level1")}
                </button>
              ))}
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
                    <span className={s["item-name"]}>{item.file_name}</span>
                    <span className={s.meta}>{item.template_name ?? t("template.generic")}</span>
                    <span className={s.meta}>
                      {t("review.confirmedBy", { name: item.confirmed_by_name ?? "-" })}
                      {item.confirmed_at ? ` · ${formatBangkokDateTime(item.confirmed_at)}` : ""}
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
