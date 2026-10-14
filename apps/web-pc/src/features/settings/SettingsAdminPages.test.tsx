import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { loginAndOpen, logout, navigateWithinApp, WAIT } from '../../test-utils/app';

const TH = {
  forbidden: 'ไม่มีสิทธิ์เข้าถึง',
  title: 'ตั้งค่าระบบ',
  exportPath: 'เส้นทางบันทึกไฟล์ Excel',
  namingRule: 'กฎการตั้งชื่อไฟล์เก็บถาวร',
  prefixTemplate: 'เทมเพลตคำนำหน้าตามหมวด',
  reviewLevels: 'ระดับการตรวจทานต่อประเภทเอกสาร',
  reviewLevel1: 'ตรวจทาน 1 ระดับ',
  reviewLevel2: 'ตรวจทาน 2 ระดับ',
  reviewLevel0: 'ไม่ต้องตรวจทาน',
  save: 'บันทึกการตั้งค่า',
  saved: 'บันทึกการตั้งค่าสำเร็จ การเปลี่ยนแปลงถูกบันทึกแล้ว',
  verifyConfirm: 'ยืนยันการตรวจสอบ',
  statusPendingL1: 'รอตรวจทานระดับ 1',
  deliveryNoteType: 'ใบส่งของ (Delivery Note)',
  opLogTitle: 'บันทึกการดำเนินการ',
  login: 'เข้าสู่ระบบ',
};

/** 通过标签文本定位其所在设置块的输入框（标签渲染为 strong，块容器为 div）。 */
function inputAfterLabel(label: string): HTMLInputElement {
  const labelEl = screen.getByText(label);
  const container = labelEl.closest('div') as HTMLElement;
  return within(container).getByRole('textbox') as HTMLInputElement;
}

describe('参数与归档设置（FR-SYS-005/006）', () => {
  it('非 admin 直接访问设置页被拒绝并提示权限不足', async () => {
    await loginAndOpen('clerk1', '/settings');
    await waitFor(() => expect(screen.getByText(TH.forbidden)).toBeInTheDocument(), WAIT);
  }, 30000);

  it('admin 修改命名规则保存成功，录入页按新规则回显命名预览', async () => {
    await loginAndOpen('admin', '/settings');
    // 页面标题与侧边栏菜单文案相同，改用设置页独有的表单标签断言
    await waitFor(() => expect(screen.getByText(TH.exportPath)).toBeInTheDocument(), WAIT);
    const namingInput = inputAfterLabel(TH.namingRule);
    expect(namingInput.value).toBe('{DocType}_{DocNumber}_{YYYYMMDD}_{Enterprise}.{ext}');
    fireEvent.change(namingInput, { target: { value: '{DocType}/{DocNumber}_TEST.{ext}' } });
    await userEvent.click(screen.getByRole('button', { name: /บันทึกการตั้งค่า$/ }));
    await waitFor(() => expect(screen.getByText(TH.saved)).toBeInTheDocument(), WAIT);

    // 录入页命名预览使用新规则（DN-2026-003 已批准）
    navigateWithinApp('/entry-archiving');
    await waitFor(() => expect(screen.getByText('DELIVERY_NOTE/DN-2026-003_TEST.pdf')).toBeInTheDocument(), WAIT);
  }, 45000);
});

describe('复核级别配置（FR-VERIFY-010）', () => {
  it('Delivery Note 改为一级复核后，核验确认进入 pending_review_level_1', async () => {
    // admin 将 DELIVERY_NOTE 从 0 级改为 1 级
    await loginAndOpen('admin', '/settings');
    await waitFor(() => expect(screen.getByText(TH.reviewLevels)).toBeInTheDocument(), WAIT);
    // DELIVERY_NOTE 对应的级别下拉框是页面第二个 Select（顺序 INVOICE/DN/PO/RECEIPT）
    const selectors = document.querySelectorAll('.ant-select-selector');
    const dnSelector = selectors[1] as HTMLElement;
    fireEvent.mouseDown(dnSelector);
    // 下拉面板出现后选择"ตรวจทาน 1 ระดับ"
    await waitFor(
      () => expect(document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')).toBeTruthy(),
      WAIT,
    );
    const dropdown = document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)') as HTMLElement;
    await userEvent.click(within(dropdown).getByText(TH.reviewLevel1));
    await userEvent.click(screen.getByRole('button', { name: /บันทึกการตั้งค่า$/ }));
    await waitFor(() => expect(screen.getByText(TH.saved)).toBeInTheDocument(), WAIT);

    // clerk 确认一份已提取的 Delivery Note → 进入待一级复核
    await logout();
    await userEvent.type(document.querySelector('#username')!, 'clerk1');
    await userEvent.type(document.querySelector('#password')!, 'clerk1');
    await userEvent.click(screen.getByRole('button', { name: TH.login }));
    await waitFor(() => expect(window.location.pathname).not.toBe('/login'), WAIT);
    navigateWithinApp('/verification?doc=doc-ex-02'); // DN-2026-102（extracted）
    await waitFor(() => expect(screen.getByText(TH.verifyConfirm)).toBeInTheDocument(), WAIT);
    await userEvent.click(screen.getByRole('button', { name: TH.verifyConfirm }));
    await waitFor(() => expect(screen.getByText(TH.statusPendingL1)).toBeInTheDocument(), WAIT);
  }, 60000);
});

describe('操作日志（FR-SYS-003）', () => {
  it('admin 完成一次核验确认后，日志列表新增对应记录（时间倒序）', async () => {
    // admin 也有核验权限：确认 doc-ir-01 产生 confirm_verification 日志
    await loginAndOpen('admin', '/verification?doc=doc-ir-01');
    await waitFor(() => expect(screen.getByText(TH.verifyConfirm)).toBeInTheDocument(), WAIT);
    await userEvent.click(screen.getByRole('button', { name: TH.verifyConfirm }));
    await waitFor(() => expect(screen.getByText(TH.statusPendingL1)).toBeInTheDocument(), WAIT);

    navigateWithinApp('/settings/operation-log');
    // 页面标题与侧边栏菜单文案相同，直接等待日志数据行出现
    await waitFor(() => expect(screen.getByText('confirm_verification')).toBeInTheDocument(), WAIT);
    const firstRow = document.querySelector('.ant-table-tbody .ant-table-row') as HTMLElement;
    expect(within(firstRow).getByText('confirm_verification')).toBeInTheDocument();
    expect(within(firstRow).getByText(/System Administrator/)).toBeInTheDocument();
  }, 60000);
});
