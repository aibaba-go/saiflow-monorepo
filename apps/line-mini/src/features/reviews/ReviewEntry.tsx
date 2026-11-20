import { ChevronRight, ShieldCheck } from "lucide-react";
import { useNavigate } from "react-router-dom";

import { useT } from "../../i18n";
import { useCurrentTenant } from "../tenants/useCurrentTenant";
import { heldLevels, useReviewSummary } from "./api";
import s from "./reviews.module.css";

/** Home page review prompt (FR-SYS-119; prototype .review-entry "有 N 份单据待你复核"): only
 * in an organization, for holders of a review permission, and only while there is something
 * to decide; the number counts the documents this user can decide. */
export function ReviewEntry() {
  const t = useT();
  const navigate = useNavigate();
  const { tenant } = useCurrentTenant();
  const show = heldLevels(tenant).length > 0;
  const summary = useReviewSummary(show);
  const n = (summary.data?.l1 ?? 0) + (summary.data?.l2 ?? 0);
  if (!show || n <= 0) return null;
  // the sentence around the bold number, in the order each language puts it
  const [lead = "", tail = ""] = t("review.prompt", { n: "\u0000" }).split("\u0000");
  return (
    <button type="button" className={s.entry} onClick={() => navigate("/reviews")}>
      <ShieldCheck className={s["entry-icon"]} aria-hidden="true" size={19} strokeWidth={1.75} />
      <span className={s["entry-title"]}>
        {lead}
        <b className={s.badge} aria-label={t("review.count", { n })}>
          {n}
        </b>
        {tail}
      </span>
      <ChevronRight className={s["entry-chevron"]} aria-hidden="true" size={16} strokeWidth={1.75} />
    </button>
  );
}
