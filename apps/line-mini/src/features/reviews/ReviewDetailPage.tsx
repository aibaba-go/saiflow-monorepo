import { useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { BrandLoading } from "../../components/BrandLoading";
import { useT } from "../../i18n";
import { ApiError, errorMessage } from "../../services/errors";
import { formatBangkokDateTime } from "../../utils/format";
import { ChangeLog } from "../scan/components/ChangeLog";
import { FormDialog, fd } from "../scan/components/FormDialog";
import { OriginalPreview } from "../scan/components/OriginalPreview";
import { PageHeader } from "../scan/components/PageHeader";
import { StructuredDataView } from "../scan/components/StructuredDataView";
import { useResult } from "../scan/ResultPage";
import type { Group, Json } from "../scan/structured";
import theme from "../scan/theme.module.css";
import { type Decision, decideReview, type Level, useReviewDetail } from "./api";
import { ReviewRecords } from "./ReviewRecords";
import s from "./reviews.module.css";

export const COMMENT_MAX = 500;

/** Review detail (FR-SYS-120): the original, the confirmed result read-only, the review
 * history and the change log, with Approve (optional comment) and Return (comment
 * required). A document someone else already handled sends the user back to the queue. */
export function ReviewDetailPage() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { id = "" } = useParams();
  const detail = useReviewDetail(id);
  const result = useResult(id);
  const [dialog, setDialog] = useState<Decision | null>(null);
  const [comment, setComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const handled = (e: unknown) => e instanceof ApiError && (e.status === 409 || e.status === 404);
  const goBack = (notice?: string) => navigate("/reviews", { replace: true, state: notice ? { notice } : null });

  useEffect(() => {
    if (detail.isError && handled(detail.error)) goBack("handled");
    if (result.isError && handled(result.error)) goBack("handled");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.isError, detail.error, result.isError, result.error]);

  async function submit() {
    if (!dialog || !detail.data?.level) return;
    setBusy(true);
    setError(null);
    try {
      const text = comment.trim();
      await decideReview(id, detail.data.level as Level, dialog, text || null);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["reviewSummary"] }),
        queryClient.invalidateQueries({ queryKey: ["reviews"] }),
      ]);
      goBack(dialog === "approve" ? "approved" : "returned");
    } catch (e) {
      if (handled(e)) {
        await queryClient.invalidateQueries({ queryKey: ["reviews"] });
        goBack("handled");
        return;
      }
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const d = detail.data;
  const data = result.data;
  const canDecide = Boolean(d && d.level && !d.block_reason);
  const tooLong = comment.trim().length > COMMENT_MAX;
  const blank = !comment.trim();

  return (
    <div className={`${theme.scan} ${s.page}`}>
      <PageHeader title={d?.job.file_name || t("review.title")} onBack={() => goBack()} />
      {!d || !data ? (
        <div className={s.content}>
          {detail.isError && !handled(detail.error) ? (
            <p className={s.error}>{errorMessage(detail.error, t)}</p>
          ) : result.isError && !handled(result.error) ? (
            <p className={s.error}>{errorMessage(result.error, t)}</p>
          ) : (
            <BrandLoading variant="inline" label={t("common.loading")} />
          )}
        </div>
      ) : (
        <div className={s.content}>
          <div className={s.meta}>
            {t(d.level === 2 ? "review.pending2" : "review.pending1")}
            {" · "}
            {t("review.confirmedBy", { name: d.confirmed_by_name ?? "-" })}
            {d.confirmed_at ? ` · ${formatBangkokDateTime(d.confirmed_at)}` : ""}
          </div>
          {d.block_reason && (
            <div className={s.blocked}>
              {t(d.block_reason === "did_level1" ? "review.blocked.did_level1" : "review.blocked.own_confirmation")}
            </div>
          )}
          <OriginalPreview fileId={d.job.file_id} fileName={d.job.file_name} pageCount={d.job.page_count || 1} />
          <div className={s.meta}>
            {t("template.label")}: {data.template?.name ?? t("template.generic")}
          </div>
          <StructuredDataView
            value={(data.structured ?? {}) as Json}
            groups={(data.template?.groups ?? null) as Group[] | null}
            missing={new Set()}
            warnings={new Set()}
            amountIssues={new Map()}
            editable={false}
            onChange={() => {}}
          />
          <ReviewRecords records={data.review.records} />
          <ChangeLog jobId={id} groups={(data.template?.groups ?? null) as Group[] | null} />
        </div>
      )}
      {canDecide && (
        <div className={s["action-bar"]}>
          <button type="button" className={s.danger} onClick={() => { setComment(""); setDialog("return"); }}>
            {t("review.return")}
          </button>
          <button type="button" className={s.primary} onClick={() => { setComment(""); setDialog("approve"); }}>
            {t("review.approve")}
          </button>
        </div>
      )}
      {dialog && (
        <FormDialog title={t(dialog === "approve" ? "review.approveConfirm" : "review.returnConfirm")}>
          <label className={fd["fd-field"]}>
            <span className={fd["fd-label"]}>
              {t(dialog === "approve" ? "review.commentOptional" : "review.commentRequired")}
            </span>
            <textarea
              className={s.textarea}
              aria-label={t(dialog === "approve" ? "review.commentOptional" : "review.commentRequired")}
              value={comment}
              maxLength={COMMENT_MAX + 50}
              onChange={(e) => setComment(e.target.value)}
            />
          </label>
          {tooLong && <p className={s.error}>{t("review.commentTooLong", { n: COMMENT_MAX })}</p>}
          {Boolean(error) && <p className={s.error}>{errorMessage(error, t)}</p>}
          <div className={fd["fd-actions"]}>
            <button type="button" className={`${fd["fd-btn"]} ${fd.secondary}`} onClick={() => setDialog(null)}>
              {t("common.cancel")}
            </button>
            <button
              type="button"
              className={`${fd["fd-btn"]} ${dialog === "approve" ? fd.primary : fd.danger}`}
              disabled={busy || tooLong || (dialog === "return" && blank)}
              onClick={() => void submit()}
            >
              {t(dialog === "approve" ? "review.approve" : "review.return")}
            </button>
          </div>
        </FormDialog>
      )}
    </div>
  );
}
