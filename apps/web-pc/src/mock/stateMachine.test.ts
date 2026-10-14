import { describe, expect, it } from 'vitest';
import type { ExtractedField } from '../api/types';
import {
  canEnterBusiness,
  checkConfirmGate,
  currentReviewLevel,
  isFieldReadOnly,
  isPendingReview,
  statusAfterConfirm,
  statusAfterReviewDecision,
} from './stateMachine';

function field(overrides: Partial<ExtractedField> = {}): ExtractedField {
  return {
    id: 'f-1',
    document_id: 'd-1',
    field_key: 'invoice_number',
    value: 'INV-2026-001',
    raw_text: 'INV-2026-001',
    confidence: 0.97,
    needs_review: false,
    verified: false,
    required: true,
    ...overrides,
  };
}

describe('checkConfirmGate（EPIC-03 §3.3 门控）', () => {
  it('必填字段为空 → 阻止确认并指明字段', () => {
    const reason = checkConfirmGate({ amount_mismatch: false }, [
      field({ field_key: 'invoice_number', value: null }),
    ]);
    expect(reason).toEqual({ kind: 'missing_required_field', field_key: 'invoice_number' });
  });

  it('needs_review 字段未处理 → 阻止确认', () => {
    const reason = checkConfirmGate({ amount_mismatch: false }, [
      field({ field_key: 'total_price', needs_review: true, verified: false }),
    ]);
    expect(reason).toEqual({ kind: 'unresolved_needs_review', field_key: 'total_price' });
  });

  it('needs_review 字段已人工确认（verified）→ 放行', () => {
    const reason = checkConfirmGate({ amount_mismatch: false }, [
      field({ field_key: 'total_price', needs_review: true, verified: true }),
    ]);
    expect(reason).toBeNull();
  });

  it('amount_mismatch 未解决 → 阻止确认', () => {
    const reason = checkConfirmGate({ amount_mismatch: true }, [field()]);
    expect(reason).toEqual({ kind: 'amount_mismatch' });
  });

  it('门控优先级：缺失必填先于 needs_review 与金额不一致', () => {
    const reason = checkConfirmGate({ amount_mismatch: true }, [
      field({ field_key: 'invoice_number', value: null }),
      field({ field_key: 'total_price', needs_review: true, id: 'f-2' }),
    ]);
    expect(reason).toEqual({ kind: 'missing_required_field', field_key: 'invoice_number' });
  });

  it('全部通过 → 返回 null（AC-FR-VERIFY-006-01 前置）', () => {
    expect(checkConfirmGate({ amount_mismatch: false }, [field()])).toBeNull();
  });
});

describe('statusAfterConfirm（0/1/2 级复核）', () => {
  it('0 级 → approved_for_business（直批）', () => {
    expect(statusAfterConfirm(0)).toBe('approved_for_business');
  });

  it('1 级 → pending_review_level_1', () => {
    expect(statusAfterConfirm(1)).toBe('pending_review_level_1');
  });

  it('2 级 → pending_review_level_1（仍需先过一级）', () => {
    expect(statusAfterConfirm(2)).toBe('pending_review_level_1');
  });
});

describe('statusAfterReviewDecision', () => {
  it('1 级配置：一级通过 → approved_for_business', () => {
    expect(statusAfterReviewDecision('approved', 'pending_review_level_1', 1)).toBe('approved_for_business');
  });

  it('2 级配置：一级通过 → pending_review_level_2', () => {
    expect(statusAfterReviewDecision('approved', 'pending_review_level_1', 2)).toBe('pending_review_level_2');
  });

  it('2 级配置：二级通过 → approved_for_business', () => {
    expect(statusAfterReviewDecision('approved', 'pending_review_level_2', 2)).toBe('approved_for_business');
  });

  it('拒绝 → 回到 in_review（打回重验）', () => {
    expect(statusAfterReviewDecision('rejected', 'pending_review_level_1', 2)).toBe('in_review');
    expect(statusAfterReviewDecision('rejected', 'pending_review_level_2', 2)).toBe('in_review');
  });
});

describe('业务录入与只读判定', () => {
  it('仅 approved_for_business 可进入业务流程', () => {
    expect(canEnterBusiness('approved_for_business')).toBe(true);
    expect(canEnterBusiness('verified')).toBe(false);
    expect(canEnterBusiness('pending_review_level_1')).toBe(false);
    expect(canEnterBusiness('pending_review_level_2')).toBe(false);
    expect(canEnterBusiness('in_review')).toBe(false);
  });

  it('确认后（verified 起）字段只读', () => {
    expect(isFieldReadOnly('in_review')).toBe(false);
    expect(isFieldReadOnly('verified')).toBe(true);
    expect(isFieldReadOnly('pending_review_level_1')).toBe(true);
    expect(isFieldReadOnly('approved_for_business')).toBe(true);
    expect(isFieldReadOnly('archived')).toBe(true);
  });

  it('待复核状态与当前复核级别', () => {
    expect(isPendingReview('pending_review_level_1')).toBe(true);
    expect(isPendingReview('pending_review_level_2')).toBe(true);
    expect(isPendingReview('verified')).toBe(false);
    expect(currentReviewLevel('pending_review_level_1')).toBe(1);
    expect(currentReviewLevel('pending_review_level_2')).toBe(2);
    expect(currentReviewLevel('in_review')).toBeNull();
  });
});
