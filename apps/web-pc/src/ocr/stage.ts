import type { MessageKey } from "../i18n";

/** The label of a task's stage; waiting for review names its level (FR-VERIFY-017). */
export function stageKey(stage: string, level?: number | null): MessageKey {
  if (stage === "PENDING_REVIEW" && (level === 1 || level === 2)) return `review.pending${level}` as MessageKey;
  return `stage.${stage}` as MessageKey;
}

/** Where a task opens (FR-SYS-130): unfinished or failed recognition on the upload page,
 * to verify on the verify page (if the user may verify), everything else in the detail. */
export function jobTarget(job: { id: string; stage: string }, canVerify: boolean): string {
  if (["OCR_PROCESSING", "TEMPLATE_MATCHING", "OCR_FAILED"].includes(job.stage)) return `/upload?job=${job.id}`;
  if (job.stage === "VERIFYING" && canVerify) return `/verify/${job.id}`;
  return `/documents/${job.id}`;
}
