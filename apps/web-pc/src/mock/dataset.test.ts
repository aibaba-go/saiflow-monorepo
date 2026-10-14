import { describe, expect, it } from 'vitest';
import type { DocStatus } from '../api/types';
import { buildInitialData } from './dataset';
import { buildArchiveFileName } from './naming';
import { ALL_DOC_TYPES, CONFIDENCE_THRESHOLD } from './defaults';

const data = buildInitialData();

describe('mock 数据集', () => {
  it('至少 20 份单据', () => {
    expect(data.documents.length).toBeGreaterThanOrEqual(20);
  });

  it('覆盖全部 4 种 P0 单据类型', () => {
    const types = new Set(data.documents.map((doc) => doc.doc_type));
    for (const type of ALL_DOC_TYPES) {
      expect(types.has(type)).toBe(true);
    }
  });

  it('覆盖状态机全部状态（含 failed）', () => {
    const statuses = new Set(data.documents.map((doc) => doc.status));
    const expected: DocStatus[] = [
      'uploaded',
      'preprocessed',
      'extraction_requested',
      'payload_stored',
      'converting',
      'extracted',
      'in_review',
      'verified',
      'pending_review_level_1',
      'pending_review_level_2',
      'approved_for_business',
      'entered',
      'archived',
      'failed',
    ];
    for (const status of expected) {
      expect(statuses.has(status), `missing status: ${status}`).toBe(true);
    }
  });

  it('包含负样例：缺失必填、低置信度、金额不一致、上传失败', () => {
    const missingRequired = data.documents.filter((doc) =>
      data.fields.some((f) => f.document_id === doc.id && f.required && !f.value),
    );
    expect(missingRequired.length).toBeGreaterThan(0);

    const lowConfidence = data.fields.filter((f) => f.confidence < CONFIDENCE_THRESHOLD);
    expect(lowConfidence.length).toBeGreaterThan(0);

    expect(data.documents.some((doc) => doc.amount_mismatch)).toBe(true);
    expect(data.uploads.some((u) => u.status === 'failed')).toBe(true);
  });

  it('字段含泰/英/中混合文案', () => {
    const values = data.fields.map((f) => f.value ?? '').join(' ');
    expect(values).toMatch(/[฀-๿]/); // 泰文
    expect(values).toMatch(/[一-鿿]/); // 中文
    expect(values).toMatch(/[A-Za-z]/); // 英文
  });

  it('归档命名规则生成 spec 示例文件名', () => {
    const name = buildArchiveFileName({
      doc_type: 'INVOICE',
      doc_number: 'INV-2026-001',
      doc_date: '2026-09-10',
      enterprise_name: 'ACME',
      file_ext: 'pdf',
    });
    expect(name).toBe('INVOICE_INV-2026-001_20260910_ACME.pdf');
  });

  it('每份有提取结果的单据都有头部字段，早期状态无字段', () => {
    for (const doc of data.documents) {
      const fields = data.fields.filter((f) => f.document_id === doc.id);
      const hasExtraction = !['uploaded', 'preprocessed', 'extraction_requested', 'payload_stored', 'converting', 'failed'].includes(doc.status);
      if (hasExtraction) {
        expect(fields.length, `${doc.id} should have fields`).toBeGreaterThan(0);
      } else {
        expect(fields.length, `${doc.id} should have no fields`).toBe(0);
      }
    }
  });
});
