import type { ApiClient } from './ApiClient';
import { ConfirmGateError, ExportGateError, type GateReason } from './errors';
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
import { ALLOWED_EXTENSIONS, MAX_FILE_SIZE_BYTES, PAGE_SIZE_DEFAULT } from '../mock/defaults';
import { buildInitialData, createDocumentFromUpload } from '../mock/dataset';
import { buildArchiveFileName, buildArchivePrefix } from '../mock/naming';
import {
  checkConfirmGate,
  isFieldReadOnly,
  statusAfterConfirm,
  statusAfterReviewDecision,
} from '../mock/stateMachine';
import { MockStore, newId } from '../mock/store';
import { MOCK_USERS } from '../mock/users';

/** 300–800 ms 模拟网络延迟（design.md 决策 2）；测试可注入 0 延迟。 */
export interface MockLatencyOptions {
  /** [min, max] 毫秒；默认 [300, 800]。 */
  latencyMs?: [number, number];
  /** 上传阶段推进间隔毫秒；默认 1200。 */
  uploadStageMs?: number;
}

function nowIso(): string {
  return new Date().toISOString();
}

/**
 * MockApiClient —— ApiClient 的默认实现：
 * 内存 mock store + 模拟延迟 + 可控失败用例（文件名含 "fail" 触发上传失败）。
 */
export class MockApiClient implements ApiClient {
  private readonly store: MockStore;
  private readonly latency: [number, number];
  private readonly uploadStageMs: number;

  constructor(store?: MockStore, options: MockLatencyOptions = {}) {
    this.store = store ?? new MockStore(buildInitialData());
    this.latency = options.latencyMs ?? [300, 800];
    this.uploadStageMs = options.uploadStageMs ?? 1200;
  }

  private delay(): Promise<void> {
    const [min, max] = this.latency;
    const ms = min + Math.random() * (max - min);
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /** 直接暴露 store（React 订阅钩子用；真实客户端无此成员）。 */
  get mockStore(): MockStore {
    return this.store;
  }

  private requireSession(): Session {
    const session = this.store.getState().session;
    if (!session) throw new Error('unauthorized');
    return session;
  }

  private requireDoc(documentId: string): Document {
    const doc = this.store.getState().documents.find((d) => d.id === documentId);
    if (!doc) throw new Error(`document not found: ${documentId}`);
    return doc;
  }

  private logOperation(action: string, target_type: string, target_id: string): void {
    this.store.mutate(
      (draft) => {
        draft.operation_logs.unshift({
          id: newId('ol'),
          user_id: draft.session?.user.id ?? 'anonymous',
          action,
          target_type,
          target_id,
          result: 'success',
          timestamp: nowIso(),
        });
      },
      { persist: false },
    );
  }

  // ---- 会话 ----

  async login(username: string, password: string): Promise<Session> {
    await this.delay();
    const user = MOCK_USERS.find((u) => u.username === username && u.password === password);
    if (!user) throw new Error('invalid_credentials');
    const session: Session = {
      user: { id: user.id, username: user.username, display_name: user.display_name, roles: user.roles },
      token: `mock-${newId()}`,
    };
    this.store.mutate((draft) => {
      draft.session = session;
    });
    this.logOperation('login', 'session', user.id);
    return session;
  }

  async logout(): Promise<void> {
    await this.delay();
    this.store.clearSession();
  }

  // ---- 上传 ----

  async enqueueUpload(file: { name: string; size: number }): Promise<UploadQueueItem> {
    this.requireSession();
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    if (!ALLOWED_EXTENSIONS.includes(ext as (typeof ALLOWED_EXTENSIONS)[number])) {
      throw new Error('unsupported_file_type');
    }
    if (file.size > MAX_FILE_SIZE_BYTES) {
      throw new Error('file_too_large');
    }
    await this.delay();
    const item: UploadQueueItem = {
      id: newId('ul'),
      file_name: file.name,
      size: file.size,
      status: 'queued',
      document_id: null,
      error: null,
      created_at: nowIso(),
    };
    this.store.mutate((draft) => {
      draft.uploads.unshift(item);
    });
    this.advanceUpload(item.id);
    return item;
  }

  async listUploads(): Promise<UploadQueueItem[]> {
    this.requireSession();
    await this.delay();
    return [...this.store.getState().uploads];
  }

  async retryUpload(uploadId: string): Promise<UploadQueueItem> {
    await this.delay();
    const item = this.store.getState().uploads.find((u) => u.id === uploadId);
    if (!item) throw new Error(`upload not found: ${uploadId}`);
    this.store.mutate(
      (draft) => {
        const target = draft.uploads.find((u) => u.id === uploadId);
        if (target) {
          target.status = 'queued';
          target.error = null;
        }
      },
      { persist: false },
    );
    this.advanceUpload(uploadId);
    return this.store.getState().uploads.find((u) => u.id === uploadId)!;
  }

  /** Mock 自动流转：排队 → 上传中 → 预处理中 → OCR 处理中 → 已完成/失败。 */
  private advanceUpload(uploadId: string): void {
    const stages: UploadQueueItem['status'][] = ['uploading', 'preprocessing', 'ocr_processing'];
    let stageIndex = 0;
    const step = (): void => {
      const item = this.store.getState().uploads.find((u) => u.id === uploadId);
      if (!item || item.status === 'failed' || item.status === 'completed') return;
      // 可控失败用例：文件名含 "fail" 时在 OCR 阶段失败
      if (stageIndex === stages.length && item.file_name.toLowerCase().includes('fail')) {
        this.store.mutate(
          (draft) => {
            const target = draft.uploads.find((u) => u.id === uploadId);
            if (target) {
              target.status = 'failed';
              target.error = 'mock_upload_failure: OCR 服务超时 (OCR service timeout)';
            }
          },
          { persist: false },
        );
        return;
      }
      if (stageIndex < stages.length) {
        const status = stages[stageIndex];
        this.store.mutate(
          (draft) => {
            const target = draft.uploads.find((u) => u.id === uploadId);
            if (target) target.status = status;
          },
          { persist: false },
        );
        stageIndex += 1;
        setTimeout(step, this.uploadStageMs);
      } else {
        this.completeUpload(uploadId);
      }
    };
    setTimeout(step, this.uploadStageMs);
  }

  private completeUpload(uploadId: string): void {
    const created = createDocumentFromUpload(
      this.store.getState().uploads.find((u) => u.id === uploadId)?.file_name ?? 'INV-2026-unknown.pdf',
    );
    this.store.mutate(
      (draft) => {
        const target = draft.uploads.find((u) => u.id === uploadId);
        if (!target) return;
        created.document.upload_user_id = draft.session?.user.id ?? 'user-clerk1';
        created.document.status = 'extracted';
        draft.documents.unshift(created.document);
        draft.fields.unshift(...created.fields);
        draft.line_items.unshift(...created.line_items);
        target.status = 'completed';
        target.document_id = created.document.id;
      },
      { persist: false },
    );
    this.logOperation('upload_document', 'document', created.document.id);
  }

  // ---- 单据与核验 ----

  async listDocuments(filter: DocumentFilter = {}): Promise<DocumentPage> {
    this.requireSession();
    await this.delay();
    const { page = 1, page_size = PAGE_SIZE_DEFAULT, ...criteria } = filter;
    const all = this.store
      .getState()
      .documents.filter((doc) => this.matchesFilter(doc, criteria))
      .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
    return {
      items: all.slice((page - 1) * page_size, page * page_size),
      total: all.length,
      page,
      page_size,
    };
  }

  private matchesFilter(doc: Document, criteria: Omit<DocumentFilter, 'page' | 'page_size'>): boolean {
    if (criteria.doc_type && doc.doc_type !== criteria.doc_type) return false;
    if (criteria.enterprise && !(doc.enterprise_name ?? '').includes(criteria.enterprise)) return false;
    if (criteria.doc_number && !(doc.doc_number ?? '').includes(criteria.doc_number)) return false;
    if (criteria.date_from && (doc.doc_date ?? '') < criteria.date_from) return false;
    if (criteria.date_to && (doc.doc_date ?? '') > criteria.date_to) return false;
    if (criteria.statuses && !criteria.statuses.includes(doc.status)) return false;
    return true;
  }

  async getDocument(documentId: string): Promise<Document | null> {
    this.requireSession();
    await this.delay();
    return this.store.getState().documents.find((d) => d.id === documentId) ?? null;
  }

  async getExtractedFields(documentId: string): Promise<ExtractedField[]> {
    this.requireSession();
    await this.delay();
    return this.store.getState().fields.filter((f) => f.document_id === documentId);
  }

  async getLineItems(documentId: string): Promise<LineItem[]> {
    this.requireSession();
    await this.delay();
    return this.store.getState().line_items.filter((li) => li.document_id === documentId);
  }

  async updateField(input: {
    document_id: string;
    field_key: string;
    new_value: string;
    reason?: string;
  }): Promise<ExtractedField> {
    const session = this.requireSession();
    await this.delay();
    const doc = this.requireDoc(input.document_id);
    if (isFieldReadOnly(doc.status)) throw new Error('document_locked');
    let updated: ExtractedField | undefined;
    this.store.mutate(
      (draft) => {
        const field = draft.fields.find(
          (f) => f.document_id === input.document_id && f.field_key === input.field_key,
        );
        if (!field) return;
        const oldValue = field.value ?? '';
        field.value = input.new_value;
        // 人工编辑后视为已核对该字段（处理低置信度标记）
        field.verified = true;
        field.needs_review = false;
        updated = { ...field };
        draft.change_logs.push({
          id: newId('cl'),
          document_id: input.document_id,
          field_key: input.field_key,
          old_value: oldValue,
          new_value: input.new_value,
          user_id: session.user.id,
          timestamp: nowIso(),
          reason: input.reason ?? null,
        });
      },
      { persist: false },
    );
    if (!updated) throw new Error(`field not found: ${input.field_key}`);
    this.logOperation('update_field', 'document', input.document_id);
    return updated;
  }

  async batchUpdateField(input: {
    document_ids: string[];
    field_key: string;
    new_value: string;
    reason?: string;
  }): Promise<void> {
    const session = this.requireSession();
    await this.delay();
    this.store.mutate(
      (draft) => {
        for (const documentId of input.document_ids) {
          const doc = draft.documents.find((d) => d.id === documentId);
          if (!doc || isFieldReadOnly(doc.status)) continue;
          const field = draft.fields.find(
            (f) => f.document_id === documentId && f.field_key === input.field_key,
          );
          if (!field) continue;
          const oldValue = field.value ?? '';
          field.value = input.new_value;
          field.verified = true;
          field.needs_review = false;
          draft.change_logs.push({
            id: newId('cl'),
            document_id: documentId,
            field_key: input.field_key,
            old_value: oldValue,
            new_value: input.new_value,
            user_id: session.user.id,
            timestamp: nowIso(),
            reason: input.reason ?? null,
          });
        }
      },
      { persist: false },
    );
    this.logOperation('batch_update_field', 'document', input.document_ids.join(','));
  }

  async confirmVerification(documentId: string): Promise<Document> {
    this.requireSession();
    await this.delay();
    const doc = this.requireDoc(documentId);
    if (doc.status !== 'in_review' && doc.status !== 'extracted') {
      throw new Error('invalid_status_for_confirm');
    }
    const fields = this.store.getState().fields.filter((f) => f.document_id === documentId);
    const gate = checkConfirmGate(doc, fields);
    if (gate) {
      throw new ConfirmGateError(gate satisfies GateReason);
    }
    const level = this.store.getState().settings.review_levels[doc.doc_type];
    const next = statusAfterConfirm(level);
    this.store.mutate(
      (draft) => {
        const target = draft.documents.find((d) => d.id === documentId);
        if (target) {
          target.status = next;
          target.updated_at = nowIso();
          for (const field of draft.fields) {
            if (field.document_id === documentId) {
              field.verified = true;
              field.needs_review = false;
            }
          }
        }
      },
      { persist: false },
    );
    this.logOperation('confirm_verification', 'document', documentId);
    return this.requireDoc(documentId);
  }

  // ---- 复核 ----

  async listPendingReview(): Promise<Document[]> {
    this.requireSession();
    await this.delay();
    return this.store
      .getState()
      .documents.filter((doc) => doc.status === 'pending_review_level_1' || doc.status === 'pending_review_level_2')
      .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1));
  }

  async getReviewRecords(documentId: string): Promise<ReviewRecord[]> {
    this.requireSession();
    await this.delay();
    return this.store
      .getState()
      .review_records.filter((r) => r.document_id === documentId)
      .sort((a, b) => (a.reviewed_at < b.reviewed_at ? 1 : -1));
  }

  async decideReview(input: {
    document_id: string;
    decision: 'approved' | 'rejected';
    comment?: string;
  }): Promise<Document> {
    const session = this.requireSession();
    await this.delay();
    const doc = this.requireDoc(input.document_id);
    if (doc.status !== 'pending_review_level_1' && doc.status !== 'pending_review_level_2') {
      throw new Error('invalid_status_for_review');
    }
    const level = doc.status === 'pending_review_level_1' ? 1 : 2;
    const configuredLevel = this.store.getState().settings.review_levels[doc.doc_type];
    const next = statusAfterReviewDecision(input.decision, doc.status, configuredLevel);
    this.store.mutate(
      (draft) => {
        draft.review_records.push({
          id: newId('rr'),
          document_id: input.document_id,
          review_level: level as 1 | 2,
          reviewer_id: session.user.id,
          decision: input.decision,
          comment: input.comment ?? null,
          reviewed_at: nowIso(),
        });
        const target = draft.documents.find((d) => d.id === input.document_id);
        if (target) {
          target.status = next;
          target.updated_at = nowIso();
          // 拒绝打回后字段重新可编辑
          if (input.decision === 'rejected') {
            for (const field of draft.fields) {
              if (field.document_id === input.document_id) field.verified = false;
            }
          }
        }
      },
      { persist: false },
    );
    this.logOperation(`review_${input.decision}`, 'document', input.document_id);
    return this.requireDoc(input.document_id);
  }

  // ---- 变更日志 ----

  async listChangeLogs(documentId: string): Promise<ChangeLog[]> {
    this.requireSession();
    await this.delay();
    return this.store
      .getState()
      .change_logs.filter((c) => c.document_id === documentId)
      .sort((a, b) => (a.timestamp < b.timestamp ? 1 : -1));
  }

  // ---- 录入与归档 ----

  async assertExportable(documentIds: string[]): Promise<void> {
    this.requireSession();
    await this.delay();
    const notApproved = documentIds.filter((id) => {
      const doc = this.store.getState().documents.find((d) => d.id === id);
      return !doc || doc.status !== 'approved_for_business';
    });
    if (notApproved.length > 0) {
      throw new ExportGateError(notApproved);
    }
  }

  async archiveDocuments(documentIds: string[]): Promise<ArchivePage['items']> {
    this.requireSession();
    await this.delay();
    // 门控：尚未归档的单据必须处于 approved_for_business（已归档的直接回显现有记录）
    const toArchive = documentIds.filter((id) => this.requireDoc(id).status !== 'archived');
    await this.assertExportable(toArchive);
    const created: ArchivePage['items'] = [];
    this.store.mutate(
      (draft) => {
        for (const documentId of documentIds) {
          const doc = draft.documents.find((d) => d.id === documentId);
          if (!doc) continue;
          const alreadyArchived = draft.archive_records.some((r) => r.document_id === documentId);
          if (!alreadyArchived && doc.status === 'approved_for_business') {
            const prefix = buildArchivePrefix(doc, draft.settings.archive_prefix_template);
            const fileName = buildArchiveFileName(doc, draft.settings.archive_naming_rule);
            const record = {
              id: newId('ar'),
              document_id: documentId,
              original_uri: `${prefix}/${fileName}`,
              data_uri: `${prefix}/${doc.doc_number}.json`,
              archive_prefix: prefix,
              file_name: fileName,
              storage_mode: 'gcs' as const,
              archived_at: nowIso(),
            };
            draft.archive_records.push(record);
            created.push({ ...record, document: { ...doc, status: 'archived' } });
            doc.status = 'archived';
            doc.updated_at = nowIso();
          } else {
            const existing = draft.archive_records.find((r) => r.document_id === documentId);
            const current = draft.documents.find((d) => d.id === documentId);
            if (existing && current) created.push({ ...existing, document: current });
          }
        }
      },
      { persist: false },
    );
    this.logOperation('archive_documents', 'document', documentIds.join(','));
    return created;
  }

  async getArchiveRecords(query: ArchiveQuery = {}): Promise<ArchivePage> {
    this.requireSession();
    await this.delay();
    const { page = 1, page_size = PAGE_SIZE_DEFAULT, ...criteria } = query;
    const state = this.store.getState();
    const all = state.archive_records
      .map((record) => ({ ...record, document: state.documents.find((d) => d.id === record.document_id)! }))
      .filter((item) => item.document)
      .filter((item) => {
        if (criteria.doc_type && item.document.doc_type !== criteria.doc_type) return false;
        if (
          criteria.doc_number &&
          !(item.document.doc_number ?? '').toLowerCase().includes(criteria.doc_number.toLowerCase())
        ) {
          return false;
        }
        if (criteria.enterprise && !(item.document.enterprise_name ?? '').includes(criteria.enterprise)) return false;
        if (criteria.date_from && (item.document.doc_date ?? '') < criteria.date_from) return false;
        if (criteria.date_to && (item.document.doc_date ?? '') > criteria.date_to) return false;
        return true;
      })
      .sort((a, b) => (a.archived_at < b.archived_at ? 1 : -1));
    return {
      items: all.slice((page - 1) * page_size, page * page_size),
      total: all.length,
      page,
      page_size,
    };
  }

  // ---- 设置与日志 ----

  async getSettings(): Promise<Settings> {
    this.requireSession();
    await this.delay();
    return { ...this.store.getState().settings };
  }

  async updateSettings(partial: Partial<Settings>): Promise<Settings> {
    this.requireSession();
    await this.delay();
    this.store.mutate((draft) => {
      draft.settings = { ...draft.settings, ...partial };
    });
    this.logOperation('update_settings', 'settings', Object.keys(partial).join(','));
    return { ...this.store.getState().settings };
  }

  async listOperationLogs(): Promise<OperationLog[]> {
    this.requireSession();
    await this.delay();
    return [...this.store.getState().operation_logs].sort((a, b) =>
      a.timestamp < b.timestamp ? 1 : -1,
    );
  }
}
