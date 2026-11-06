import { isMessageKey, useT } from "../../../i18n";
import s from "./StatusChip.module.css";

/** Our stages in main's colours: recognising and matching amber, failed red, to verify
 * blue, confirmed green (main `StatusChip.vue`; main's COMPLETED is our CONFIRMED). */
const TONE: Record<string, string | undefined> = {
  OCR_PROCESSING: s.processing,
  TEMPLATE_MATCHING: s.processing,
  OCR_FAILED: s.failed,
  VERIFYING: s.verifying,
  CONFIRMED: s.completed,
};

export function StatusChip({ stage }: { stage: string }) {
  const t = useT();
  const key = stage === "CONFIRMED" ? "job.review.CONFIRMED" : `job.stage.${stage}`;
  return (
    <span className={[s.chip, TONE[stage]].filter(Boolean).join(" ")}>
      {isMessageKey(key) ? t(key) : stage}
    </span>
  );
}
