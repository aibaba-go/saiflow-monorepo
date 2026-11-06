import { isMessageKey, useT } from "../../../i18n";
import s from "./StatusChip.module.css";

/** Our stages in main's colours: recognising and matching amber, failed red, to verify
 * blue, confirmed green (main `StatusChip.vue`; main's COMPLETED is our CONFIRMED). */
const TONE: Record<string, string | undefined> = {
  OCR_PROCESSING: s.processing,
  TEMPLATE_MATCHING: s.processing,
  OCR_FAILED: s.failed,
  VERIFYING: s.verifying,
  PENDING_REVIEW: s.processing,
  CONFIRMED: s.completed,
};

/** A task waiting for review names its level: 待一级复核 / 待二级复核 (FR-VERIFY-017). */
export function StatusChip({ stage, level }: { stage: string; level?: number | null }) {
  const t = useT();
  const key =
    stage === "CONFIRMED"
      ? "job.review.CONFIRMED"
      : stage === "PENDING_REVIEW" && (level === 1 || level === 2)
        ? `review.pending${level}`
        : `job.stage.${stage}`;
  return (
    <span className={[s.chip, TONE[stage]].filter(Boolean).join(" ")}>
      {isMessageKey(key) ? t(key) : stage}
    </span>
  );
}
