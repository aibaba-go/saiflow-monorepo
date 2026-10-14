import type {
  ArchiveRecord,
  ChangeLog,
  DocStatus,
  Document,
  DocumentType,
  ExtractedField,
  LineItem,
  OperationLog,
  ReviewRecord,
  UploadQueueItem,
} from '../api/types';
import type { MockStoreState } from './store';
import { CONFIDENCE_THRESHOLD } from './defaults';
import { buildArchiveFileName, buildArchivePrefix } from './naming';

/**
 * Mock 数据集（design.md 决策 5）：25 份单据覆盖 4 种 P0 类型与状态机全部状态，
 * 含低置信度（< 0.85）、缺失必填、金额不一致、上传失败负样例与泰/英/中混合字段。
 * 数据确定性生成，刷新后重置。
 */

/** 各类型头部字段定义：field_key / 是否必填（EPIC-02 §3）。 */
const HEADER_FIELDS: Record<DocumentType, { key: string; required: boolean }[]> = {
  INVOICE: [
    { key: 'invoice_number', required: true },
    { key: 'order_number', required: false },
    { key: 'supplier_name', required: false },
    { key: 'demander_name', required: false },
    { key: 'contact_person', required: false },
    { key: 'contact_info', required: false },
    { key: 'order_date', required: false },
    { key: 'delivery_date', required: false },
    { key: 'total_price', required: true },
    { key: 'tax_amount', required: false },
    { key: 'signature_info', required: false },
    { key: 'remarks', required: false },
  ],
  PO: [
    { key: 'order_number', required: true },
    { key: 'supplier_name', required: false },
    { key: 'demander_name', required: false },
    { key: 'contact_person', required: false },
    { key: 'contact_info', required: false },
    { key: 'order_date', required: false },
    { key: 'delivery_date', required: false },
    { key: 'total_price', required: true },
    { key: 'signature_info', required: false },
    { key: 'remarks', required: false },
  ],
  DELIVERY_NOTE: [
    { key: 'delivery_note_number', required: true },
    { key: 'associated_order_number', required: false },
    { key: 'delivery_enterprise', required: false },
    { key: 'receiving_enterprise', required: false },
    { key: 'outbound_time', required: false },
    { key: 'logistics_info', required: false },
    { key: 'signature_confirmation', required: false },
  ],
  RECEIPT: [
    { key: 'receipt_number', required: true },
    { key: 'payer_name', required: false },
    { key: 'payee_name', required: false },
    { key: 'amount', required: true },
    { key: 'payment_date', required: false },
    { key: 'payment_method', required: false },
    { key: 'reference_number', required: false },
  ],
};

/** 交易对手（泰/英/中混合，NFR-I18N-001）。 */
const ENTERPRISES = [
  'ACME Manufacturing Co., Ltd.',
  'บริษัท สยามเคมีภัณฑ์ จำกัด',
  '曼谷五金制品有限公司 (Bangkok Hardware)',
  'Thai Global Trading Co., Ltd.',
  'บริษัท ซัมมิท อิเล็คทริค จำกัด',
  'Golden Dragon Steel จำกัด (มหาชน)',
] as const;

/** 行项目商品名（泰/英/中混合）。 */
const PRODUCTS = [
  'เหล็กเส้นกลม 12 มม. (Round Steel Bar)',
  'Bearing SKF-6204 ZZ',
  '铝制散热片 Aluminum Heat Sink 40×40',
  'สกรูหัวกลม ลวดเกลียว M6×25 (Screw)',
  'Hydraulic Hose 1/2" 2SC',
  'น้ำมันหล่อลื่นอุตสาหกรรม 20L (Lubricant)',
] as const;

interface DocSpec {
  id: string;
  doc_type: DocumentType;
  status: DocStatus;
  number: string;
  date: string;
  total: number | null;
  ext: Document['file_ext'];
  enterprise: string;
  /** 字段值覆盖（负样例：缺失/低置信度/金额不一致）。 */
  overrides?: Record<string, { value?: string | null; confidence?: number }>;
}

/** 47 份单据：每行一个状态样本；负样例集中标注；22 份归档填充数据用于分页演示。 */
const DOC_SPECS: DocSpec[] = [
  // ---- 上传/预处理链路（字段尚未提取） ----
  { id: 'doc-up-01', doc_type: 'INVOICE', status: 'uploaded', number: 'INV-2026-101', date: '2026-09-28', total: null, ext: 'jpg', enterprise: ENTERPRISES[3] },
  { id: 'doc-up-02', doc_type: 'DELIVERY_NOTE', status: 'preprocessed', number: 'DN-2026-101', date: '2026-09-28', total: null, ext: 'png', enterprise: ENTERPRISES[0] },
  { id: 'doc-up-03', doc_type: 'PO', status: 'extraction_requested', number: 'PO-2026-101', date: '2026-09-27', total: null, ext: 'pdf', enterprise: ENTERPRISES[2] },
  { id: 'doc-up-04', doc_type: 'RECEIPT', status: 'payload_stored', number: 'RCPT-2026-101', date: '2026-09-27', total: null, ext: 'jpg', enterprise: ENTERPRISES[1] },
  { id: 'doc-up-05', doc_type: 'INVOICE', status: 'converting', number: 'INV-2026-102', date: '2026-09-27', total: null, ext: 'png', enterprise: ENTERPRISES[5] },
  { id: 'doc-up-06', doc_type: 'PO', status: 'failed', number: 'PO-2026-102', date: '2026-09-26', total: null, ext: 'pdf', enterprise: ENTERPRISES[4] },

  // ---- OCR 完成、待核验 ----
  { id: 'doc-ex-01', doc_type: 'INVOICE', status: 'extracted', number: 'INV-2026-103', date: '2026-09-26', total: 8400, ext: 'pdf', enterprise: ENTERPRISES[0] },
  { id: 'doc-ex-02', doc_type: 'DELIVERY_NOTE', status: 'extracted', number: 'DN-2026-102', date: '2026-09-26', total: null, ext: 'jpg', enterprise: ENTERPRISES[1] },

  // ---- 核验中（in_review）：1 份干净 + 3 份负样例 ----
  // doc-ir-01 即归档命名规则的演示单据：ACME / INV-2026-001 / 2026-09-10 / pdf
  { id: 'doc-ir-01', doc_type: 'INVOICE', status: 'in_review', number: 'INV-2026-001', date: '2026-09-10', total: 12500, ext: 'pdf', enterprise: 'ACME' },
  { id: 'doc-ir-02', doc_type: 'INVOICE', status: 'in_review', number: 'INV-2026-002', date: '2026-09-11', total: 9800, ext: 'pdf', enterprise: ENTERPRISES[1],
    overrides: { invoice_number: { value: null, confidence: 0.9 } } }, // 缺失必填
  { id: 'doc-ir-03', doc_type: 'INVOICE', status: 'in_review', number: 'INV-2026-003', date: '2026-09-12', total: 15200, ext: 'png', enterprise: ENTERPRISES[2],
    overrides: { total_price: { confidence: 0.62 } } }, // 低置信度
  { id: 'doc-ir-04', doc_type: 'PO', status: 'in_review', number: 'PO-2026-001', date: '2026-09-13', total: 46200, ext: 'pdf', enterprise: ENTERPRISES[4] }, // 金额不一致

  // ---- 已核验 / 待复核 ----
  { id: 'doc-vf-01', doc_type: 'DELIVERY_NOTE', status: 'verified', number: 'DN-2026-001', date: '2026-09-14', total: null, ext: 'pdf', enterprise: ENTERPRISES[3] },
  { id: 'doc-vf-02', doc_type: 'RECEIPT', status: 'verified', number: 'RCPT-2026-001', date: '2026-09-15', total: 7300, ext: 'jpg', enterprise: ENTERPRISES[5] },
  { id: 'doc-pr-01', doc_type: 'INVOICE', status: 'pending_review_level_1', number: 'INV-2026-010', date: '2026-09-16', total: 21000, ext: 'pdf', enterprise: ENTERPRISES[0] },
  { id: 'doc-pr-02', doc_type: 'RECEIPT', status: 'pending_review_level_1', number: 'RCPT-2026-002', date: '2026-09-17', total: 4300, ext: 'png', enterprise: ENTERPRISES[1] },
  { id: 'doc-pr-03', doc_type: 'INVOICE', status: 'pending_review_level_2', number: 'INV-2026-011', date: '2026-09-18', total: 33400, ext: 'pdf', enterprise: ENTERPRISES[2] },

  // ---- 已批准（可录入/导出） ----
  { id: 'doc-ap-01', doc_type: 'DELIVERY_NOTE', status: 'approved_for_business', number: 'DN-2026-003', date: '2026-09-19', total: null, ext: 'pdf', enterprise: ENTERPRISES[0] },
  { id: 'doc-ap-02', doc_type: 'INVOICE', status: 'approved_for_business', number: 'INV-2026-012', date: '2026-09-20', total: 18700, ext: 'png', enterprise: ENTERPRISES[4] },
  { id: 'doc-ap-03', doc_type: 'RECEIPT', status: 'approved_for_business', number: 'RCPT-2026-003', date: '2026-09-21', total: 2600, ext: 'jpg', enterprise: ENTERPRISES[3] },

  // ---- 已录入 / 已归档 ----
  { id: 'doc-en-01', doc_type: 'INVOICE', status: 'entered', number: 'INV-2026-013', date: '2026-09-22', total: 9600, ext: 'pdf', enterprise: ENTERPRISES[5] },
  { id: 'doc-en-02', doc_type: 'PO', status: 'entered', number: 'PO-2026-002', date: '2026-09-23', total: 31500, ext: 'pdf', enterprise: ENTERPRISES[1] },
  { id: 'doc-ar-01', doc_type: 'INVOICE', status: 'archived', number: 'INV-2026-014', date: '2026-09-24', total: 14300, ext: 'pdf', enterprise: ENTERPRISES[0] },
  { id: 'doc-ar-02', doc_type: 'DELIVERY_NOTE', status: 'archived', number: 'DN-2026-004', date: '2026-09-25', total: null, ext: 'jpg', enterprise: ENTERPRISES[2] },
  { id: 'doc-ar-03', doc_type: 'RECEIPT', status: 'archived', number: 'RCPT-2026-004', date: '2026-09-25', total: 5200, ext: 'png', enterprise: ENTERPRISES[4] },

  // ---- 归档浏览填充数据（FR-MGMT-001 分页演示：归档 > 20 条） ----
  ...Array.from({ length: 22 }, (_, i): DocSpec => ({
    id: `doc-ar-f${String(i + 1).padStart(2, '0')}`,
    doc_type: 'INVOICE',
    status: 'archived',
    number: `INV-2026-${String(201 + i)}`,
    date: `2026-09-${String((i % 26) + 1).padStart(2, '0')}`,
    total: 5000 + i * 100,
    ext: 'pdf',
    enterprise: ENTERPRISES[i % ENTERPRISES.length],
  })),
];

/** 哪些状态已产生 OCR 提取结果。 */
function hasExtraction(status: DocStatus): boolean {
  return (
    status === 'extracted' ||
    status === 'in_review' ||
    status === 'verified' ||
    status === 'pending_review_level_1' ||
    status === 'pending_review_level_2' ||
    status === 'approved_for_business' ||
    status === 'entered' ||
    status === 'archived'
  );
}

/** 确定性伪随机（避免数据集每次刷新不同）。 */
function seededConfidence(seed: number, salt = 0): number {
  const x = Math.sin(seed * 999 + salt * 77) * 10000;
  const frac = x - Math.floor(x);
  // 0.86–0.99 之间
  return Math.round((0.86 + frac * 0.13) * 100) / 100;
}

/** 头部字段值：按 field_key 与单据信息生成。 */
function headerFieldValue(spec: DocSpec, fieldKey: string): string | null {
  const override = spec.overrides?.[fieldKey];
  if (override && 'value' in override) return override.value ?? null;
  switch (fieldKey) {
    case 'invoice_number':
    case 'order_number':
    case 'delivery_note_number':
    case 'receipt_number':
      return spec.number;
    case 'associated_order_number':
      return `PO-2026-0${(spec.number.match(/\d+$/)?.[0] ?? '1').slice(-2)}`;
    case 'supplier_name':
    case 'delivery_enterprise':
    case 'payer_name':
      return spec.enterprise;
    case 'demander_name':
    case 'receiving_enterprise':
    case 'payee_name':
      return 'บริษัท ไทยเฟลโลว์ จำกัด (ThaiFellow Manufacturing)';
    case 'total_price':
    case 'amount':
      return spec.total === null ? null : spec.total.toFixed(2);
    case 'tax_amount':
      return spec.total === null ? null : (spec.total * 0.07).toFixed(2);
    case 'order_date':
    case 'payment_date':
      return spec.date;
    case 'delivery_date':
      return shiftDate(spec.date, 5);
    case 'outbound_time':
      return `${spec.date} 08:30`;
    case 'contact_person':
      return 'คุณสมชาย วีระกุล (Mr. Somchai Wira)';
    case 'contact_info':
      return '+66 2 123 4567';
    case 'logistics_info':
      return 'ขนส่ง บริษัท ไทยขนส่งด่วน จำกัด (Thai Express)';
    case 'payment_method':
      return 'โอนเงิน (Bank Transfer)';
    case 'reference_number':
      return `REF-${spec.number.slice(-3)}`;
    case 'signature_info':
    case 'signature_confirmation':
      return 'ลงนามแล้ว (Signed)';
    case 'remarks':
      return 'หมายเหตุ: ส่งมอบตามรอบเช้า (Morning delivery batch)';
    default:
      return null;
  }
}

function shiftDate(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function buildFields(spec: DocSpec, docId: string): ExtractedField[] {
  if (!hasExtraction(spec.status)) return [];
  return HEADER_FIELDS[spec.doc_type].map((def, index) => {
    const override = spec.overrides?.[def.key];
    const confidence = override?.confidence ?? seededConfidence(index + 1, spec.id.length);
    const value = headerFieldValue(spec, def.key);
    return {
      id: `${docId}-f${index + 1}`,
      document_id: docId,
      field_key: def.key,
      value,
      raw_text: value,
      confidence,
      needs_review: confidence < CONFIDENCE_THRESHOLD || value === null,
      verified: false,
      required: def.required,
    } satisfies ExtractedField;
  });
}

function buildLineItems(spec: DocSpec, docId: string): LineItem[] {
  if (!hasExtraction(spec.status)) return [];
  if (spec.doc_type === 'RECEIPT') return [];
  const count = 2 + (spec.id.charCodeAt(spec.id.length - 1) % 2); // 2–3 行
  return Array.from({ length: count }, (_, i) => {
    const quantity = 5 + i * 3;
    const unitPrice = 120 + i * 45;
    return {
      id: `${docId}-li${i + 1}`,
      document_id: docId,
      line_no: i + 1,
      product_name: PRODUCTS[(i + spec.id.length) % PRODUCTS.length],
      product_code: `SKU-10${(i + 1) * (spec.id.length % 3 + 1)}`,
      quantity,
      unit_price: unitPrice,
      line_total: quantity * unitPrice,
      discount: 0,
      tax_amount: Math.round(quantity * unitPrice * 0.07),
      confidence: seededConfidence(i + 3, spec.id.length),
    } satisfies LineItem;
  });
}

function buildDocument(spec: DocSpec): Document {
  const fields = buildFields(spec, spec.id);
  const needsReview = fields.some((f) => f.needs_review && !f.verified);
  const isMismatch = spec.id === 'doc-ir-04'; // 金额不一致负样例
  const confidences = fields.map((f) => f.confidence);
  return {
    id: spec.id,
    doc_type: spec.doc_type,
    status: spec.status,
    original_file_uri: `/samples/${spec.number}.svg`,
    file_ext: spec.ext,
    source_channel: 'scan',
    upload_user_id: 'user-clerk1',
    enterprise_name: spec.enterprise,
    doc_number: spec.number,
    doc_date: spec.date,
    total_amount: spec.total,
    amount_mismatch: isMismatch,
    needs_review: needsReview,
    confidence_avg: confidences.length
      ? Math.round((confidences.reduce((a, b) => a + b, 0) / confidences.length) * 100) / 100
      : null,
    created_at: `${spec.date}T09:00:00Z`,
    updated_at: `${spec.date}T10:30:00Z`,
  };
}

/** 复核记录：种子数据让待复核/已批准单据有完整复核轨迹可展示。 */
function buildReviewRecords(documents: Document[]): ReviewRecord[] {
  const records: ReviewRecord[] = [];
  // doc-pr-03 处于二级待复核 —— 已有一级通过记录
  records.push({
    id: 'rr-001',
    document_id: 'doc-pr-03',
    review_level: 1,
    reviewer_id: 'user-reviewer1',
    decision: 'approved',
    comment: 'ข้อมูลถูกต้อง ผ่านการตรวจสอบระดับ 1 (Level 1 passed)',
    reviewed_at: '2026-09-18T14:00:00Z',
  });
  // doc-ir-03 曾被拒绝打回（低置信度单据）
  records.push({
    id: 'rr-002',
    document_id: 'doc-ir-03',
    review_level: 1,
    reviewer_id: 'user-reviewer1',
    decision: 'rejected',
    comment: 'ยอดรวมไม่ตรงกับรายการ โปรดตรวจสอบอีกครั้ง (Total mismatch, please re-check)',
    reviewed_at: '2026-09-19T10:00:00Z',
  });
  // 已批准/已归档单据的完整复核轨迹
  for (const doc of documents) {
    if (doc.status === 'approved_for_business' || doc.status === 'entered' || doc.status === 'archived') {
      records.push({
        id: `rr-${doc.id}-l1`,
        document_id: doc.id,
        review_level: 1,
        reviewer_id: 'user-reviewer1',
        decision: 'approved',
        comment: null,
        reviewed_at: `${doc.doc_date}T15:00:00Z`,
      });
      if (doc.doc_type === 'INVOICE' || doc.doc_type === 'PO') {
        records.push({
          id: `rr-${doc.id}-l2`,
          document_id: doc.id,
          review_level: 2,
          reviewer_id: 'user-finance1',
          decision: 'approved',
          comment: 'ตรวจสอบโดยฝ่ายบัญชี (Approved by finance)',
          reviewed_at: `${doc.doc_date}T16:30:00Z`,
        });
      }
    }
  }
  return records;
}

/** 归档记录：已归档单据的双重存储（原件 + 结构化数据）。 */
function buildArchiveRecords(documents: Document[]): ArchiveRecord[] {
  return documents
    .filter((doc) => doc.status === 'archived')
    .map((doc) => {
      const prefix = buildArchivePrefix(doc);
      const fileName = buildArchiveFileName(doc);
      return {
        id: `ar-${doc.id}`,
        document_id: doc.id,
        original_uri: `${prefix}/${fileName}`,
        data_uri: `${prefix}/${doc.doc_number}.json`,
        archive_prefix: prefix,
        file_name: fileName,
        storage_mode: 'gcs',
        archived_at: `${doc.doc_date}T18:00:00Z`,
      } satisfies ArchiveRecord;
    });
}

function buildChangeLogs(): ChangeLog[] {
  return [
    {
      id: 'cl-001',
      document_id: 'doc-ir-03',
      field_key: 'total_price',
      old_value: '15200.00',
      new_value: '15180.00',
      user_id: 'user-clerk1',
      timestamp: '2026-09-19T11:00:00Z',
      reason: 'ตรวจสอบกับใบเสร็จต้นฉบับ (Checked with original receipt)',
    },
    {
      id: 'cl-002',
      document_id: 'doc-ar-01',
      field_key: 'supplier_name',
      old_value: 'ACME Manufactur',
      new_value: 'ACME Manufacturing Co., Ltd.',
      user_id: 'user-clerk1',
      timestamp: '2026-09-24T09:20:00Z',
      reason: null,
    },
  ];
}

function buildOperationLogs(): OperationLog[] {
  return [
    {
      id: 'ol-001',
      user_id: 'user-clerk1',
      action: 'login',
      target_type: 'session',
      target_id: 'user-clerk1',
      result: 'success',
      timestamp: '2026-09-24T08:00:00Z',
    },
    {
      id: 'ol-002',
      user_id: 'user-clerk1',
      action: 'upload_document',
      target_type: 'document',
      target_id: 'doc-up-01',
      result: 'success',
      timestamp: '2026-09-24T08:05:00Z',
    },
    {
      id: 'ol-003',
      user_id: 'user-admin',
      action: 'update_settings',
      target_type: 'settings',
      target_id: 'archive_naming_rule',
      result: 'success',
      timestamp: '2026-09-23T17:00:00Z',
    },
  ];
}

function buildUploads(): UploadQueueItem[] {
  return [
    {
      id: 'ul-001',
      file_name: 'DN-2026-101.png',
      size: 2_400_000,
      status: 'completed',
      document_id: 'doc-up-02',
      error: null,
      created_at: '2026-09-28T08:10:00Z',
    },
    {
      id: 'ul-002',
      file_name: 'PO-2026-102.pdf',
      size: 5_100_000,
      status: 'failed',
      document_id: null,
      error: 'mock_upload_failure: OCR 服务超时 (OCR service timeout)',
      created_at: '2026-09-26T09:00:00Z',
    },
    {
      id: 'ul-003',
      file_name: 'INV-2026-102.png',
      size: 3_800_000,
      status: 'ocr_processing',
      document_id: null,
      error: null,
      created_at: '2026-09-27T13:00:00Z',
    },
  ];
}

/** 按单据类型导出头部字段键（批量更正等界面选择用）。 */
export function headerFieldKeys(docType: DocumentType): string[] {
  return HEADER_FIELDS[docType].map((def) => def.key);
}

/** 从文件名推断单据类型（上传完成后生成 Mock 提取结果用）。 */
export function guessDocType(fileName: string): DocumentType {
  const lower = fileName.toLowerCase();
  if (lower.startsWith('dn-')) return 'DELIVERY_NOTE';
  if (lower.startsWith('po-')) return 'PO';
  if (lower.startsWith('rcpt-')) return 'RECEIPT';
  return 'INVOICE';
}

/** 上传完成（OCR 已完成）后生成一份新的 extracted 单据及其提取结果。 */
export function createDocumentFromUpload(fileName: string): {
  document: Document;
  fields: ExtractedField[];
  line_items: LineItem[];
} {
  const docType = guessDocType(fileName);
  const seq = String(Date.now()).slice(-5);
  const numbers: Record<DocumentType, string> = {
    INVOICE: `INV-2026-2${seq}`,
    DELIVERY_NOTE: `DN-2026-2${seq}`,
    PO: `PO-2026-2${seq}`,
    RECEIPT: `RCPT-2026-2${seq}`,
  };
  const ext = fileName.toLowerCase().endsWith('.png') ? 'png' : fileName.toLowerCase().endsWith('.jpg') || fileName.toLowerCase().endsWith('.jpeg') ? 'jpg' : 'pdf';
  const spec: DocSpec = {
    id: `doc-new-${seq}`,
    doc_type: docType,
    status: 'extracted',
    number: numbers[docType],
    date: new Date().toISOString().slice(0, 10),
    total: 7700,
    ext,
    enterprise: 'ACME',
  };
  return {
    document: buildDocument(spec),
    fields: buildFields(spec, spec.id),
    line_items: buildLineItems(spec, spec.id),
  };
}

/** 组装完整初始业务数据（不含 session/settings）。 */
export function buildInitialData(): Omit<MockStoreState, 'session' | 'settings'> {
  const documents = DOC_SPECS.map(buildDocument);
  return {
    documents,
    fields: DOC_SPECS.flatMap((spec) => buildFields(spec, spec.id)),
    line_items: DOC_SPECS.flatMap((spec) => buildLineItems(spec, spec.id)),
    change_logs: buildChangeLogs(),
    review_records: buildReviewRecords(documents),
    archive_records: buildArchiveRecords(documents),
    operation_logs: buildOperationLogs(),
    uploads: buildUploads(),
  };
}
