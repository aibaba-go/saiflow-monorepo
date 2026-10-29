import type {
  ArchivePage,
  ArchiveQuery,
  ChangeLog,
  Document,
  DocumentFilter,
  DocumentPage,
  ExtractedField,
  LineItem,
  OperationLog,
  ReviewRecord,
  Session,
  Settings,
  UploadQueueItem,
} from './types';

/**
 * ApiClient —— 页面唯一依赖的数据访问接口（design.md 决策 2 / ADR-002）。
 * 默认实现为 MockApiClient；接入真实后端时新增 RealApiClient 并替换 Provider 注入。
 */
export interface ApiClient {
  // ---- 会话（shell-auth） ----
  login(username: string, password: string): Promise<Session>;
  logout(): Promise<void>;

  // ---- 上传工作台（upload-queue） ----
  /** 校验并入队一个文件；格式/大小不合法时抛出本地化错误。 */
  enqueueUpload(file: { name: string; size: number }): Promise<UploadQueueItem>;
  listUploads(): Promise<UploadQueueItem[]>;
  retryUpload(uploadId: string): Promise<UploadQueueItem>;

  // ---- 单据与核验（verification-workbench） ----
  listDocuments(filter?: DocumentFilter): Promise<DocumentPage>;
  getDocument(documentId: string): Promise<Document | null>;
  getExtractedFields(documentId: string): Promise<ExtractedField[]>;
  getLineItems(documentId: string): Promise<LineItem[]>;
  /** 编辑单个字段并追加 DM-ChangeLog。 */
  updateField(input: {
    document_id: string;
    field_key: string;
    new_value: string;
    reason?: string;
  }): Promise<ExtractedField>;
  /** 跨文档批量更正（FR-VERIFY-003）：对多份单据的同一字段批量赋值，逐单记录日志。 */
  batchUpdateField(input: {
    document_ids: string[];
    field_key: string;
    new_value: string;
    reason?: string;
  }): Promise<void>;
  /**
   * 确认核验（FR-VERIFY-006/009）：先执行门控校验（§3.3），
   * 不通过时抛出携带原因的 ConfirmGateError；通过后按复核级别推进状态。
   */
  confirmVerification(documentId: string): Promise<Document>;

  // ---- 复核（verification-workbench / review） ----
  listPendingReview(): Promise<Document[]>;
  getReviewRecords(documentId: string): Promise<ReviewRecord[]>;
  /** 通过或拒绝一份待复核单据（decision: approved / rejected）。 */
  decideReview(input: {
    document_id: string;
    decision: 'approved' | 'rejected';
    comment?: string;
  }): Promise<Document>;

  // ---- 变更日志 ----
  listChangeLogs(documentId: string): Promise<ChangeLog[]>;

  // ---- 录入与归档（entry-archiving） ----
  /** 导出门控：任一单据非 approved_for_business 时抛错（FR-VERIFY-012）。 */
  assertExportable(documentIds: string[]): Promise<void>;
  /** 将已批准单据置为 entered 并生成 Mock 双重存储归档记录（FR-ENTRY-005/006）。 */
  archiveDocuments(documentIds: string[]): Promise<ArchivePage['items']>;
  getArchiveRecords(query?: ArchiveQuery): Promise<ArchivePage>;

  // ---- 设置与日志（settings-admin） ----
  getSettings(): Promise<Settings>;
  updateSettings(partial: Partial<Settings>): Promise<Settings>;
  listOperationLogs(): Promise<OperationLog[]>;
}
