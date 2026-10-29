/**
 * 领域类型 —— 对齐 docs/30-design/Data-Model.md 的实体与枚举命名。
 * 后端 OpenAPI 契约生成后，本文件将被 packages/api-client 的生成物替换。
 */

/** Data-Model §3 `DocumentType` — V1.0 P0 四种单据类型。 */
export type DocumentType = 'PO' | 'DELIVERY_NOTE' | 'INVOICE' | 'RECEIPT';

/** Data-Model §3 `DocStatus` —— 完整生命周期状态（含 failed）。 */
export type DocStatus =
  | 'uploaded'
  | 'preprocessed'
  | 'extraction_requested'
  | 'payload_stored'
  | 'converting'
  | 'extracted'
  | 'in_review'
  | 'verified'
  | 'pending_review_level_1'
  | 'pending_review_level_2'
  | 'approved_for_business'
  | 'entered'
  | 'archived'
  | 'failed';

/** Data-Model §3 `Role`。 */
export type Role = 'clerk' | 'finance' | 'reviewer' | 'viewer' | 'admin';

/** DM-User（原型略去 password_hash）。 */
export interface User {
  id: string;
  username: string;
  display_name: string;
  roles: Role[];
}

/** Mock 会话。 */
export interface Session {
  user: User;
  token: string;
}

/** DM-Document。 */
export interface Document {
  id: string;
  doc_type: DocumentType;
  status: DocStatus;
  /** 原件 URI；原型中为本地 samples 路径。 */
  original_file_uri: string;
  /** 文件扩展名（用于归档命名）。 */
  file_ext: 'pdf' | 'jpg' | 'png';
  source_channel: 'camera' | 'scan' | 'file' | 'email' | 'portal' | 'api';
  upload_user_id: string;
  enterprise_name: string | null;
  doc_number: string | null;
  doc_date: string | null; // ISO date
  total_amount: number | null;
  amount_mismatch: boolean;
  needs_review: boolean;
  confidence_avg: number | null;
  created_at: string; // ISO datetime
  updated_at: string;
}

/** DM-ExtractedField。 */
export interface ExtractedField {
  id: string;
  document_id: string;
  field_key: string;
  value: string | null;
  raw_text: string | null;
  confidence: number; // 0–1
  needs_review: boolean;
  verified: boolean;
  /** 必填字段（门控用）；EPIC-02 §3 各类型必需字段。 */
  required: boolean;
}

/** DM-LineItem。 */
export interface LineItem {
  id: string;
  document_id: string;
  line_no: number;
  product_name: string | null;
  product_code: string | null;
  quantity: number | null;
  unit_price: number | null;
  line_total: number | null;
  discount: number | null;
  tax_amount: number | null;
  confidence: number;
}

/** DM-ChangeLog（原型略去 integrity_hash）。 */
export interface ChangeLog {
  id: string;
  document_id: string;
  field_key: string;
  old_value: string;
  new_value: string;
  user_id: string;
  timestamp: string;
  reason: string | null;
}

/** 复核级别：无需复核 0 / 一级 1 / 二级 2（DM-ReviewPolicy.review_level）。 */
export type ReviewLevel = 0 | 1 | 2;

/** DM-ReviewRecord（原型略去 integrity_hash）。 */
export interface ReviewRecord {
  id: string;
  document_id: string;
  review_level: 1 | 2;
  reviewer_id: string;
  decision: 'approved' | 'rejected';
  comment: string | null;
  reviewed_at: string;
}

/** DM-ArchiveRecord（storage_mode 固定 'gcs'；原型仅 Mock 展示）。 */
export interface ArchiveRecord {
  id: string;
  document_id: string;
  original_uri: string;
  data_uri: string;
  archive_prefix: string;
  file_name: string;
  storage_mode: 'gcs';
  archived_at: string;
}

/** DM-OperationLog。 */
export interface OperationLog {
  id: string;
  user_id: string;
  action: string;
  target_type: string;
  target_id: string;
  result: string;
  timestamp: string;
}

/** 归档命名规则模板：可含占位符 {DocType} {DocNumber} {YYYYMMDD} {Enterprise} {ext}；admin 可在设置页修改。 */
export type NamingRule = string;

/** DM-Settings（scope=system 的参数集；原型 Mock 存储）。 */
export interface Settings {
  /** Excel 导出默认保存路径（浏览器无法真实落盘，仅记录并回显）。 */
  export_save_path: string;
  archive_naming_rule: NamingRule;
  /** 归档分类前缀模板：gcs://<bucket>/{DocType}/{Year}/{Month}/{Enterprise}。 */
  archive_prefix_template: string;
  /** 按单据类型配置的复核级别（FR-VERIFY-010）。 */
  review_levels: Record<DocumentType, ReviewLevel>;
}

/** 上传队列条目状态：排队 → 上传中 → 预处理中 → OCR 处理中 → 已完成/失败。 */
export type UploadStatus = 'queued' | 'uploading' | 'preprocessing' | 'ocr_processing' | 'completed' | 'failed';

export interface UploadQueueItem {
  id: string;
  file_name: string;
  size: number;
  status: UploadStatus;
  /** 处理完成后关联的文档 id，用于跳转核验工作台。 */
  document_id: string | null;
  error: string | null;
  created_at: string;
}

/** 文档列表过滤条件（归档管理/核验列表共用）。 */
export interface DocumentFilter {
  doc_type?: DocumentType;
  enterprise?: string;
  doc_number?: string;
  date_from?: string;
  date_to?: string;
  statuses?: DocStatus[];
  page?: number;
  page_size?: number;
}

export interface DocumentPage {
  items: Document[];
  total: number;
  page: number;
  page_size: number;
}

/** 归档记录查询条件。 */
export interface ArchiveQuery {
  doc_type?: DocumentType;
  /** 编号子串检索（不区分大小写，FR-MGMT-002）。 */
  doc_number?: string;
  enterprise?: string;
  date_from?: string;
  date_to?: string;
  page?: number;
  page_size?: number;
}

export interface ArchivePage {
  items: (ArchiveRecord & { document: Document })[];
  total: number;
  page: number;
  page_size: number;
}
