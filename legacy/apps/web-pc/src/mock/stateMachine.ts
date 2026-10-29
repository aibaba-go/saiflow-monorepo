import type { GateReason } from '../api/errors';
import { ConfirmGateError } from '../api/errors';
import type { DocStatus, Document, ExtractedField, ReviewLevel } from '../api/types';

/**
 * 核验与复核状态机 —— 纯函数模块，规则直接来自 EPIC-03 §3.1 / §3.3：
 *
 *   extracted → in_review → verified → pending_review_level_1
 *            → pending_review_level_2 → approved_for_business → entered → archived
 *
 * - 0 级复核：确认直接 in_review → approved_for_business
 * - 1 级复核：确认 → pending_review_level_1；一级通过 → approved_for_business
 * - 2 级复核：确认 → pending_review_level_1；一级通过 → pending_review_level_2；二级通过 → approved_for_business
 * - 拒绝：回到 in_review 并保留意见；重新提交生成新的待复核记录
 * - approved_for_business 是允许进入业务流程（导出/录入）的唯一状态
 */

/** 确认门控（EPIC-03 §3.3 / FR-VERIFY-009）。返回首个阻断原因，可确认时返回 null。 */
export function checkConfirmGate(document: Pick<Document, 'amount_mismatch'>, fields: ExtractedField[]): GateReason | null {
  const missing = fields.find((field) => field.required && !field.value);
  if (missing) {
    return { kind: 'missing_required_field', field_key: missing.field_key };
  }
  const unhandled = fields.find((field) => field.needs_review && !field.verified);
  if (unhandled) {
    return { kind: 'unresolved_needs_review', field_key: unhandled.field_key };
  }
  if (document.amount_mismatch) {
    return { kind: 'amount_mismatch' };
  }
  return null;
}

/**
 * 确认核验后的目标状态（FR-VERIFY-006/010/011）。
 * 门控由调用方先以 checkConfirmGate 校验；此处仅按复核级别推导状态。
 */
export function statusAfterConfirm(reviewLevel: ReviewLevel): DocStatus {
  if (reviewLevel === 0) return 'approved_for_business';
  return 'pending_review_level_1';
}

/** 复核决定后的目标状态（FR-VERIFY-011/012）。rejected 一律打回 in_review。 */
export function statusAfterReviewDecision(
  decision: 'approved' | 'rejected',
  currentStatus: DocStatus,
  configuredLevel: ReviewLevel,
): DocStatus {
  if (decision === 'rejected') {
    return 'in_review';
  }
  if (currentStatus === 'pending_review_level_1') {
    return configuredLevel >= 2 ? 'pending_review_level_2' : 'approved_for_business';
  }
  if (currentStatus === 'pending_review_level_2') {
    return 'approved_for_business';
  }
  return currentStatus;
}

/** approved_for_business 是允许业务录入/导出的唯一状态（FR-VERIFY-012）。 */
export function canEnterBusiness(status: DocStatus): boolean {
  return status === 'approved_for_business';
}

/** 确认后字段只读（FR-VERIFY-006/009）：verified 及其后的所有状态均只读。 */
export function isFieldReadOnly(status: DocStatus): boolean {
  return (
    status === 'verified' ||
    status === 'pending_review_level_1' ||
    status === 'pending_review_level_2' ||
    status === 'approved_for_business' ||
    status === 'entered' ||
    status === 'archived'
  );
}

/** 待复核列表应展示的状态。 */
export function isPendingReview(status: DocStatus): boolean {
  return status === 'pending_review_level_1' || status === 'pending_review_level_2';
}

/** 当前单据处于哪一级待复核（1 / 2）；不在待复核状态时返回 null。 */
export function currentReviewLevel(status: DocStatus): 1 | 2 | null {
  if (status === 'pending_review_level_1') return 1;
  if (status === 'pending_review_level_2') return 2;
  return null;
}

/** 工具：构造门控错误（供 MockApiClient 使用）。 */
export function makeConfirmGateError(reason: GateReason): ConfirmGateError {
  return new ConfirmGateError(reason);
}
