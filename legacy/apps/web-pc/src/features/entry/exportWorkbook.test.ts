import * as XLSX from 'xlsx';
import { describe, expect, it } from 'vitest';
import type { Document, ExtractedField } from '../../api/types';
import { headerFieldKeys } from '../../mock/dataset';
import { buildExportWorkbook, exportFileName } from './exportWorkbook';

/** 构造一份最小 Document（仅导出所需字段）。 */
function makeDoc(id: string, docType: Document['doc_type'], number: string): Document {
  return {
    id,
    doc_type: docType,
    status: 'approved_for_business',
    original_file_uri: `/samples/${number}.svg`,
    file_ext: 'pdf',
    source_channel: 'scan',
    upload_user_id: 'user-clerk1',
    enterprise_name: 'ACME',
    doc_number: number,
    doc_date: '2026-09-20',
    total_amount: 1000,
    amount_mismatch: false,
    needs_review: false,
    confidence_avg: 0.95,
    created_at: '2026-09-20T09:00:00Z',
    updated_at: '2026-09-20T10:00:00Z',
  };
}

function makeField(docId: string, fieldKey: string, value: string): ExtractedField {
  return {
    id: `${docId}#${fieldKey}`,
    document_id: docId,
    field_key: fieldKey,
    value,
    raw_text: value,
    confidence: 0.95,
    needs_review: false,
    verified: true,
    required: false,
  };
}

describe('Excel 模板与一键填充（FR-ENTRY-001/002）', () => {
  it('批量导出 5 份 Invoice：一个 .xlsx 工作簿含 5 条已填充记录', () => {
    const docs = Array.from({ length: 5 }, (_, i) => makeDoc(`doc-b-${i + 1}`, 'INVOICE', `INV-2026-20${i + 1}`));
    const fields = docs.flatMap((doc) => [
      makeField(doc.id, 'invoice_number', doc.doc_number!),
      makeField(doc.id, 'supplier_name', 'ACME Manufacturing Co., Ltd.'),
      makeField(doc.id, 'total_price', '10000.00'),
    ]);
    const workbook = buildExportWorkbook(docs, fields);
    // 序列化为真实 .xlsx 再读回，验证文件可打开
    const bytes = XLSX.write(workbook, { type: 'array', bookType: 'xlsx' }) as ArrayBuffer;
    const reopened = XLSX.read(bytes, { type: 'array' });
    expect(reopened.SheetNames).toEqual(['INVOICE']);
    const rows = XLSX.utils.sheet_to_json<unknown[]>(reopened.Sheets.INVOICE, { header: 1 });
    expect(rows).toHaveLength(6); // 表头 + 5 条记录
    // 表头 = Invoice 模板字段
    expect(rows[0]).toEqual(headerFieldKeys('INVOICE'));
    // 每条记录的映射字段已填充
    const invoiceNumberIndex = (rows[0] as string[]).indexOf('invoice_number');
    const totalPriceIndex = (rows[0] as string[]).indexOf('total_price');
    expect(rows.slice(1).map((row) => row?.[invoiceNumberIndex])).toEqual([
      'INV-2026-201',
      'INV-2026-202',
      'INV-2026-203',
      'INV-2026-204',
      'INV-2026-205',
    ]);
    expect(rows.slice(1).every((row) => row?.[totalPriceIndex] === '10000.00')).toBe(true);
  });

  it('多类型合并导出：每类型一个工作表，各自按模板填充', () => {
    const docs = [
      makeDoc('doc-m-1', 'DELIVERY_NOTE', 'DN-2026-001'),
      makeDoc('doc-m-2', 'RECEIPT', 'RCPT-2026-001'),
    ];
    const fields = [
      makeField('doc-m-1', 'delivery_note_number', 'DN-2026-001'),
      makeField('doc-m-2', 'receipt_number', 'RCPT-2026-001'),
    ];
    const workbook = buildExportWorkbook(docs, fields);
    expect(workbook.SheetNames).toEqual(['DELIVERY_NOTE', 'RECEIPT']);
    const dnRows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.DELIVERY_NOTE, { header: 1 });
    expect(dnRows[0]).toEqual(headerFieldKeys('DELIVERY_NOTE'));
    const receiptRows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets.RECEIPT, { header: 1 });
    const receiptNumberIndex = (receiptRows[0] as string[]).indexOf('receipt_number');
    expect(receiptRows[1]?.[receiptNumberIndex]).toBe('RCPT-2026-001');
  });

  it('导出文件名格式', () => {
    expect(exportFileName(new Date('2026-10-13T14:30:05'))).toBe('SaiFlow_Export_20261013-143005.xlsx');
  });
});
