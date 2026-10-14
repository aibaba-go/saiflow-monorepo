import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { loginAndOpen, logout, navigateWithinApp, WAIT } from '../../test-utils/app';

const TH = {
  exportOne: 'ส่งออก Excel',
  exportSelected: 'ส่งออกที่เลือก',
  archiveSelected: 'เก็บถาวรที่เลือก',
  notApproved: 'เอกสารยังไม่ผ่านการตรวจทาน จึงยังบันทึก/ส่งออกไม่ได้',
  exportModalTitle: 'ส่งออกไปยัง Excel',
  savePath: 'เส้นทางบันทึกไฟล์',
  confirm: 'ยืนยัน',
  exportSuccess1: 'ส่งออก 1 ระเบียนแล้ว',
  exportSuccess3: 'ส่งออก 3 ระเบียนแล้ว',
  archiveSuccess3: 'เก็บถาวร 3 เอกสารแล้ว',
  archiveSection: 'บันทึกการเก็บถาวร (จัดเก็บสองรูปแบบ — Mock)',
  artifactsOriginal: 'ภาพต้นฉบับ',
  artifactsData: 'ข้อมูลโครงสร้าง (JSON)',
  noApprovedSelected: 'เลือกเอกสารที่อนุมัติแล้วก่อนเก็บถาวร',
  // 核验/复核复用文案
  verifyOpen: 'ตรวจสอบ',
  verifyConfirm: 'ยืนยันการตรวจสอบ',
  approve: 'อนุมัติ',
  statusPendingL1: 'รอตรวจทานระดับ 1',
  statusPendingL2: 'รอตรวจทานระดับ 2',
};

function rowOf(docNumber: string): HTMLElement {
  const cell = screen.getByText(docNumber);
  return cell.closest('tr') as HTMLElement;
}

/** 打开导出对话框（行内单份或批量）。 */
async function openExportModal(row?: HTMLElement): Promise<void> {
  if (row) {
    await userEvent.click(within(row).getByRole('button', { name: TH.exportOne }));
  }
  await waitFor(() => expect(screen.getByText(TH.exportModalTitle)).toBeInTheDocument(), WAIT);
}

describe('Excel 录入门控（FR-ENTRY-001/002，FR-VERIFY-012）', () => {
  it('pending 单据尝试导出被拦截并提示未通过复核', async () => {
    await loginAndOpen('clerk1', '/entry-archiving');
    await waitFor(() => expect(screen.getByText('INV-2026-010')).toBeInTheDocument(), WAIT); // doc-pr-01 待一级复核
    const row = rowOf('INV-2026-010');
    await openExportModal(row);
    await userEvent.click(screen.getByRole('button', { name: TH.confirm }));
    await waitFor(() => expect(screen.getByText(TH.notApproved)).toBeInTheDocument(), WAIT);
    // 对话框保持打开（未导出）
    expect(screen.getByText(TH.exportModalTitle)).toBeInTheDocument();
  }, 45000);

  it('已批准单据导出成功，修改保存路径后再次导出回显新路径', async () => {
    await loginAndOpen('clerk1', '/entry-archiving');
    await waitFor(() => expect(screen.getByText('DN-2026-003')).toBeInTheDocument(), WAIT); // doc-ap-01 已批准
    const row = rowOf('DN-2026-003');
    await openExportModal(row);
    // 默认路径回显（对话框内唯一的 textbox 即路径输入）
    const modalEl = document.querySelector('.ant-modal') as HTMLElement;
    const pathInput = within(modalEl).getByRole('textbox') as HTMLInputElement;
    expect(pathInput.value).toBe('C:\\SaiFlow\\Exports');
    // 修改保存路径并确认导出
    await userEvent.clear(pathInput);
    await userEvent.type(pathInput, 'D:\\MyExports');
    await userEvent.click(screen.getByRole('button', { name: TH.confirm }));
    await waitFor(() => expect(screen.getByText(TH.exportSuccess1)).toBeInTheDocument(), WAIT);

    // 再次导出另一份：对话框回显修改后的路径（FR-ENTRY-004）
    const row2 = rowOf('RCPT-2026-003'); // doc-ap-03
    await openExportModal(row2);
    const modalEl2 = document.querySelector('.ant-modal') as HTMLElement;
    const pathInput2 = within(modalEl2).getByRole('textbox') as HTMLInputElement;
    expect(pathInput2.value).toBe('D:\\MyExports');
  }, 45000);

  it('批量导出多份已批准单据合并为一个 .xlsx', async () => {
    await loginAndOpen('clerk1', '/entry-archiving');
    await waitFor(() => expect(screen.getByText('DN-2026-003')).toBeInTheDocument(), WAIT);
    for (const docNumber of ['DN-2026-003', 'INV-2026-012', 'RCPT-2026-003']) {
      const row = rowOf(docNumber);
      await userEvent.click(within(row).getByRole('checkbox'));
    }
    await userEvent.click(screen.getByRole('button', { name: `${TH.exportSelected} (3)` }));
    await waitFor(() => expect(screen.getByText(/จะส่งออก 3 เอกสาร/)).toBeInTheDocument(), WAIT);
    await userEvent.click(screen.getByRole('button', { name: TH.confirm }));
    await waitFor(() => expect(screen.getByText(TH.exportSuccess3)).toBeInTheDocument(), WAIT);
  }, 45000);
});

describe('Mock 归档（FR-ENTRY-005/006/007）', () => {
  it('归档已批准单据：双重存储工件与分类前缀可见，未批准选择被拦截', async () => {
    await loginAndOpen('clerk1', '/entry-archiving');
    await waitFor(() => expect(screen.getByText('DN-2026-003')).toBeInTheDocument(), WAIT);
    // 只勾待复核单据 → 归档被拦截
    const pendingRow = rowOf('RCPT-2026-002'); // doc-pr-02 待一级
    await userEvent.click(within(pendingRow).getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: TH.archiveSelected }));
    await waitFor(() => expect(screen.getByText(TH.noApprovedSelected)).toBeInTheDocument(), WAIT);

    // 改选已批准单据 → 归档成功，记录区出现两类工件 + 分类前缀
    await userEvent.click(within(pendingRow).getByRole('checkbox')); // 取消
    const approvedRow = rowOf('DN-2026-003');
    await userEvent.click(within(approvedRow).getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: TH.archiveSelected }));
    await waitFor(() => expect(screen.getByText('เก็บถาวร 1 เอกสารแล้ว')).toBeInTheDocument(), WAIT);
    await waitFor(
      () => expect(screen.getAllByText(/gs:\/\/saiflow-documents\/DELIVERY_NOTE\/2026\/09\//).length).toBeGreaterThan(0),
      WAIT,
    );
    expect(screen.getAllByText(new RegExp(TH.artifactsOriginal)).length).toBeGreaterThan(0);
    // 文案含字面括号，需转义后再作正则
    expect(screen.getAllByText(new RegExp(TH.artifactsData.replace(/[()]/g, '\\$&'))).length).toBeGreaterThan(0);
  }, 45000);

  it('spec 黄金场景：ACME INV-2026-001 走完整链路后归档名 INVOICE_INV-2026-001_20260910_ACME.pdf', async () => {
    // clerk 确认（INVOICE 2 级 → 待一级复核）
    await loginAndOpen('clerk1', '/verification?doc=doc-ir-01');
    await waitFor(() => expect(screen.getByText(TH.verifyConfirm)).toBeInTheDocument(), WAIT);
    await userEvent.click(screen.getByRole('button', { name: TH.verifyConfirm }));
    await waitFor(() => expect(screen.getByText(TH.statusPendingL1)).toBeInTheDocument(), WAIT);

    // reviewer 两级复核通过 → approved_for_business
    await logout();
    await userEvent.type(document.querySelector('#username')!, 'reviewer1');
    await userEvent.type(document.querySelector('#password')!, 'reviewer1');
    await userEvent.click(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }));
    await waitFor(() => expect(window.location.pathname).not.toBe('/login'), WAIT);
    navigateWithinApp('/review');
    for (let i = 0; i < 2; i += 1) {
      await waitFor(() => expect(screen.getByText('INV-2026-001')).toBeInTheDocument(), WAIT);
      const row = rowOf('INV-2026-001');
      await userEvent.click(within(row).getByRole('button', { name: /อนุมัติ$/ }));
      const modal = document.querySelector('.ant-modal') as HTMLElement;
      await waitFor(() => expect(modal).toBeInTheDocument(), WAIT);
      await userEvent.click(within(modal).getByRole('button', { name: TH.approve }));
      await waitFor(() => expect(screen.getByText('อนุมัติสำเร็จ')).toBeInTheDocument(), WAIT);
    }

    // clerk 在录入页看到命名预览 → 归档 → 记录含黄金文件名
    await logout();
    await userEvent.type(document.querySelector('#username')!, 'clerk1');
    await userEvent.type(document.querySelector('#password')!, 'clerk1');
    await userEvent.click(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }));
    await waitFor(() => expect(window.location.pathname).not.toBe('/login'), WAIT);
    navigateWithinApp('/entry-archiving');
    await waitFor(() => expect(screen.getByText('INV-2026-001')).toBeInTheDocument(), WAIT);
    const row = rowOf('INV-2026-001');
    // 命名预览（与 naming 规则一致）
    const expectedName = 'INVOICE_INV-2026-001_20260910_ACME.pdf';
    expect(within(row).getByText(expectedName)).toBeInTheDocument();
    await userEvent.click(within(row).getByRole('checkbox'));
    await userEvent.click(screen.getByRole('button', { name: TH.archiveSelected }));
    // 归档后：单据离开录入列表，归档记录区展示黄金文件名（双重存储工件之一）
    await waitFor(() => expect(screen.queryByText('INV-2026-001')).not.toBeInTheDocument(), WAIT);
    const archiveCard = screen.getByText(TH.archiveSection).closest('.ant-card') as HTMLElement;
    await waitFor(() => expect(within(archiveCard).getByText(expectedName)).toBeInTheDocument(), WAIT);
    expect(
      within(archiveCard).getAllByText(/gs:\/\/saiflow-documents\/INVOICE\/2026\/09\/ACME\//).length,
    ).toBeGreaterThan(0);
  }, 90000);
});
