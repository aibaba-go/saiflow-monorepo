/** 确认门控（FR-VERIFY-009 / EPIC-03 §3.3）失败原因的机器可读标识。 */
export type GateReason =
  | { kind: 'missing_required_field'; field_key: string }
  | { kind: 'unresolved_needs_review'; field_key: string }
  | { kind: 'amount_mismatch' };

/** 门控拒绝错误：UI 依据 reason 渲染本地化提示（如 "Missing required field: invoice_number"）。 */
export class ConfirmGateError extends Error {
  readonly reason: GateReason;

  constructor(reason: GateReason) {
    super(`confirm_gate:${reason.kind}`);
    this.name = 'ConfirmGateError';
    this.reason = reason;
  }
}

/** 导出门控错误：FR-VERIFY-012 —— 非 approved_for_business 单据不得录入/导出。 */
export class ExportGateError extends Error {
  readonly documentIds: string[];

  constructor(documentIds: string[]) {
    super('export_gate:not_approved');
    this.name = 'ExportGateError';
    this.documentIds = documentIds;
  }
}
