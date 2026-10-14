import { beforeEach, describe, expect, it } from 'vitest';
import { MockApiClient } from './MockApiClient';
import { ConfirmGateError, ExportGateError } from './errors';
import { MockStore } from '../mock/store';
import { buildInitialData } from '../mock/dataset';
import type { DocStatus } from './types';

/** 0 延迟客户端 + 独立 store（测试互不干扰）。 */
function makeClient(): MockApiClient {
  return new MockApiClient(new MockStore(buildInitialData(), null), { latencyMs: [0, 0] });
}

function findDocByNumber(client: MockApiClient, number: string) {
  const state = client.mockStore.getState();
  return state.documents.find((d) => d.doc_number === number)!;
}

describe('MockApiClient 登录与工作台全链路', () => {
  let client: MockApiClient;

  beforeEach(() => {
    client = makeClient();
  });

  it('Mock 凭据登录成功后可获取单据列表', async () => {
    await expect(client.listDocuments()).rejects.toThrow('unauthorized');
    const session = await client.login('clerk1', 'clerk1');
    expect(session.user.roles).toEqual(['clerk']);

    const page = await client.listDocuments();
    expect(page.total).toBeGreaterThanOrEqual(20);
  });

  it('错误凭据被拒绝', async () => {
    await expect(client.login('clerk1', 'wrong')).rejects.toThrow('invalid_credentials');
  });

  it('AC-FR-VERIFY-006-02：缺失必填字段阻止确认并给出原因', async () => {
    await client.login('clerk1', 'clerk1');
    const doc = findDocByNumber(client, 'INV-2026-002'); // invoice_number 为空的负样例
    try {
      await client.confirmVerification(doc.id);
      expect.unreachable('confirm should have been blocked');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfirmGateError);
      expect((error as ConfirmGateError).reason).toEqual({
        kind: 'missing_required_field',
        field_key: 'invoice_number',
      });
    }
  });

  it('AC-FR-VERIFY-006-01：干净单据确认后锁定（按复核级别进入待复核）', async () => {
    await client.login('clerk1', 'clerk1');
    const doc = findDocByNumber(client, 'INV-2026-001'); // Invoice 默认 2 级复核
    const confirmed = await client.confirmVerification(doc.id);
    expect(confirmed.status).toBe('pending_review_level_1');

    // 二级复核流转：一级通过 → pending_review_level_2；二级通过 → approved_for_business
    const afterL1 = await client.decideReview({ document_id: doc.id, decision: 'approved' });
    expect(afterL1.status).toBe('pending_review_level_2');
    const afterL2 = await client.decideReview({ document_id: doc.id, decision: 'approved', comment: 'ok' });
    expect(afterL2.status).toBe('approved_for_business');

    // 复核记录含级别、复核人、时间与决定
    const records = await client.getReviewRecords(doc.id);
    expect(records.filter((r) => r.decision === 'approved')).toHaveLength(2);
  });

  it('0 级复核（Delivery Note）确认后直接 approved_for_business', async () => {
    await client.login('clerk1', 'clerk1');
    const doc = findDocByNumber(client, 'DN-2026-102'); // extracted 状态，DN 默认 0 级复核
    const confirmed = await client.confirmVerification(doc.id);
    expect(confirmed.status).toBe('approved_for_business');
  });

  it('拒绝打回 in_review，重新确认生成新的复核流转', async () => {
    await client.login('clerk1', 'clerk1');
    const doc = findDocByNumber(client, 'INV-2026-001'); // in_review，Invoice 默认 2 级
    await client.confirmVerification(doc.id);
    const rejected = await client.decideReview({
      document_id: doc.id,
      decision: 'rejected',
      comment: '金额需要复核',
    });
    expect(rejected.status).toBe('in_review');

    // 意见保留在复核记录中
    const records = await client.getReviewRecords(doc.id);
    expect(records.some((r) => r.decision === 'rejected' && r.comment === '金额需要复核')).toBe(true);

    // 重新提交后再次进入待复核
    const resubmitted = await client.confirmVerification(doc.id);
    expect(resubmitted.status).toBe('pending_review_level_1');
  });

  it('编辑字段后变更日志新增记录', async () => {
    await client.login('clerk1', 'clerk1');
    const doc = findDocByNumber(client, 'INV-2026-001');
    const field = client.mockStore.getState().fields.find(
      (f) => f.document_id === doc.id && f.field_key === 'total_price',
    )!;
    await client.updateField({ document_id: doc.id, field_key: 'total_price', new_value: '12500.00' });
    const logs = await client.listChangeLogs(doc.id);
    const entry = logs.find((l) => l.field_key === 'total_price');
    expect(entry).toBeDefined();
    expect(entry!.old_value).toBe(field.value);
    expect(entry!.new_value).toBe('12500.00');
  });

  it('非 approved_for_business 单据禁止导出（FR-VERIFY-012）', async () => {
    await client.login('clerk1', 'clerk1');
    const pending = findDocByNumber(client, 'INV-2026-010'); // pending_review_level_1
    const approved = findDocByNumber(client, 'DN-2026-003'); // approved_for_business
    await expect(client.assertExportable([pending.id])).rejects.toThrow(ExportGateError);
    await expect(client.assertExportable([approved.id])).resolves.toBeUndefined();
  });

  it('归档后生成双重存储记录与命名文件', async () => {
    await client.login('clerk1', 'clerk1');
    const doc = findDocByNumber(client, 'DN-2026-003');
    const created = await client.archiveDocuments([doc.id]);
    expect(created).toHaveLength(1);
    expect(created[0].original_uri).toContain('DELIVERY_NOTE');
    expect(created[0].data_uri.endsWith('.json')).toBe(true);
    const status: DocStatus = client.mockStore.getState().documents.find((d) => d.id === doc.id)!.status;
    expect(status).toBe('archived');
  });

  it('上传非法格式/超限文件被拒绝且不入队', async () => {
    await client.login('clerk1', 'clerk1');
    await expect(client.enqueueUpload({ name: 'invoice.docx', size: 1000 })).rejects.toThrow('unsupported_file_type');
    await expect(client.enqueueUpload({ name: 'big.png', size: 30 * 1024 * 1024 })).rejects.toThrow('file_too_large');
    expect(client.mockStore.getState().uploads.length).toBe(3); // 仅种子数据
  });

  it('核验确认写入操作日志', async () => {
    await client.login('clerk1', 'clerk1');
    const doc = findDocByNumber(client, 'DN-2026-102');
    await client.confirmVerification(doc.id);
    const logs = await client.listOperationLogs();
    expect(logs.some((l) => l.action === 'confirm_verification' && l.target_id === doc.id)).toBe(true);
  });
});
