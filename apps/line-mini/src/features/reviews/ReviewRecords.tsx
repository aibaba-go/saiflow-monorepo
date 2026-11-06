import { useT } from "../../i18n";
import { formatBangkokDateTime } from "../../utils/format";
import type { ReviewRecord } from "./api";
import s from "./reviews.module.css";

/** Every review decision of a job, oldest first (FR-VERIFY-013): level, reviewer, time,
 * decision and comment. Nothing is shown when there is no record yet. */
export function ReviewRecords({ records }: { records: ReviewRecord[] }) {
  const t = useT();
  if (!records.length) return null;
  return (
    <section className={s.section} aria-label={t("review.records")}>
      <div className={s["section-title"]}>{t("review.records")}</div>
      {records.map((r, i) => (
        <div key={i} className={s.record}>
          <div>
            <span className={r.decision === "APPROVE" ? s.approve : s.return}>
              {t(r.decision === "APPROVE" ? "review.decision.APPROVE" : "review.decision.RETURN")}
            </span>
            {" · "}
            {t(r.level === 2 ? "review.level2" : "review.level1")}
          </div>
          <div className={s.meta}>
            {r.reviewer_name ?? "-"} · {formatBangkokDateTime(r.created_at)}
          </div>
          {r.comment && <div>{r.comment}</div>}
        </div>
      ))}
    </section>
  );
}
