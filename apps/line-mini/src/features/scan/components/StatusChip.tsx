import { isMessageKey, useT } from "../../../i18n";
import s from "./StatusChip.module.css";

/** Our stages in the STD-008 colours, the same as web-pc (FR-SYS-133): recognising and
 * matching warning, failed danger, to verify info, waiting for review review, confirmed
 * success (main `StatusChip.vue`; main's COMPLETED is our CONFIRMED). */
const TONE: Record<string, string | undefined> = {
  OCR_PROCESSING: s.processing,
  TEMPLATE_MATCHING: s.processing,
  OCR_FAILED: s.failed,
  VERIFYING: s.verifying,
  PENDING_REVIEW: s.review,
  CONFIRMED: s.completed,
};

/** A task waiting for review names its level: 待一级复核 / 待二级复核 (FR-VERIFY-017).
 * A returned task gets a second, danger chip "Returned" (FR-SYS-133-02). */
export function StatusChip({
  stage,
  level,
  returned = false,
}: {
  stage: string;
  level?: number | null;
  returned?: boolean;
}) {
  const t = useT();
  const key =
    stage === "CONFIRMED"
      ? "job.review.CONFIRMED"
      : stage === "PENDING_REVIEW" && (level === 1 || level === 2)
        ? `review.pending${level}`
        : `job.stage.${stage}`;
  const chip = (
    <span className={[s.chip, TONE[stage]].filter(Boolean).join(" ")}>{isMessageKey(key) ? t(key) : stage}</span>
  );
  if (!returned) return chip;
  return (
    <span className={s.chips}>
      {chip}
      <span className={[s.chip, s.failed].join(" ")}>{t("review.returned")}</span>
    </span>
  );
}
