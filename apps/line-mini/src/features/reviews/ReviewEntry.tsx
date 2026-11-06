import { useNavigate } from "react-router-dom";

import { useT } from "../../i18n";
import { useCurrentTenant } from "../tenants/useCurrentTenant";
import { heldLevels, useReviewSummary } from "./api";
import s from "./reviews.module.css";

/** Home page "To review" entry (FR-SYS-119): only in an organization, for holders of a
 * review permission; the number counts the documents this user can decide. */
export function ReviewEntry() {
  const t = useT();
  const navigate = useNavigate();
  const { tenant } = useCurrentTenant();
  const show = heldLevels(tenant).length > 0;
  const summary = useReviewSummary(show);
  if (!show) return null;
  const n = (summary.data?.l1 ?? 0) + (summary.data?.l2 ?? 0);
  return (
    <button type="button" className={s.entry} onClick={() => navigate("/reviews")}>
      <span className={s["entry-title"]}>{t("review.entry")}</span>
      <span className={s.badge} aria-label={t("review.count", { n })}>
        {n}
      </span>
    </button>
  );
}
