import type { MessageKey } from "../i18n";
import { can } from "../tenants/permissions";
import type { CurrentTenant } from "../tenants/useCurrentTenant";

/** The label of a task's stage; waiting for review names its level (FR-VERIFY-017). */
export function stageKey(stage: string, level?: number | null): MessageKey {
  if (stage === "PENDING_REVIEW" && (level === 1 || level === 2)) return `review.pending${level}` as MessageKey;
  return `stage.${stage}` as MessageKey;
}

/** Whether this user may change this job: verify_own for their own job, verify_others
 * for a colleague's (the backend's rule, FR-VERIFY-015; final review 3). */
export function canEditJob(
  job: { created_by_user_id?: number | null },
  tenant: CurrentTenant | null,
  userId: number | null | undefined,
): boolean {
  const mine = job.created_by_user_id != null && job.created_by_user_id === userId;
  return can(tenant, mine ? "verify_own" : "verify_others");
}

/** Where a task opens (FR-SYS-130): unfinished or failed recognition on the upload page,
 * to verify on the verify page (if the user may verify), everything else in the detail. */
export function jobTarget(job: { id: string; stage: string }, canVerify: boolean): string {
  if (["OCR_PROCESSING", "TEMPLATE_MATCHING", "OCR_FAILED"].includes(job.stage)) return `/upload?job=${job.id}`;
  if (job.stage === "VERIFYING" && canVerify) return `/verify/${job.id}`;
  return `/documents/${job.id}`;
}
