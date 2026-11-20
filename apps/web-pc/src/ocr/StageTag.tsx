import "./stageTag.css";

import { useT } from "../i18n";
import { stageKey } from "./stage";

type Tone = "warning" | "danger" | "info" | "review" | "success";

/** STD-008 §2.4: the colour of each stage, the same as the mini app (FR-SYS-133). */
const TONE: Record<string, Tone> = {
  OCR_PROCESSING: "warning",
  TEMPLATE_MATCHING: "warning",
  OCR_FAILED: "danger",
  VERIFYING: "info",
  PENDING_REVIEW: "review",
  CONFIRMED: "success",
};

export function StageTag({ stage, level }: { stage: string; level?: number | null }) {
  const t = useT();
  return <span className={`stage-tag stage-tag--${TONE[stage] ?? "info"}`}>{t(stageKey(stage, level))}</span>;
}

/** A returned task: an extra danger tag next to "To verify" (FR-SYS-133). */
export function ReturnedTag() {
  const t = useT();
  return <span className="stage-tag stage-tag--danger">{t("ocr.returned")}</span>;
}
