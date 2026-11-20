import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { loginAndOpen, logout, navigateWithinApp, WAIT } from '../../test-utils/app';

const TH = {
  // 核验列表 / 详情
  openDetail: 'ตรวจสอบ',
  confirm: 'ยืนยันการตรวจสอบ',
  confirmSuccess: 'ยืนยันการตรวจสอบสำเร็จ',
  saved: 'บันทึกแล้ว',
  save: 'บันทึก',
  changeLogs: 'บันทึกการเปลี่ยนแปลง',
  reviewRecords: 'บันทึกการตรวจทาน',
  originalImage: 'ภาพต้นฉบับ',
  headerFields: 'ฟิลด์หัวเอกสาร',
  lineItems: 'รายการสินค้า',
  needsReview: 'ต้องยืนยันโดยมนุษย์',
  missingRequired: 'ฟิลด์บังคับขาดหาย',
  pendingAlertTitle: 'รายการที่ต้องจัดการก่อนยืนยัน',
  gateMissing: 'ฟิลด์บังคับยังไม่ได้กรอก: เลขที่ใบแจ้งหนี้',
  gateMismatch: 'ยอดรวมไม่ตรงกับรายการสินค้า กรุณาตรวจสอบ',
  statusInReview: 'กำลังตรวจสอบ',
  statusPendingL1: 'รอตรวจทานระดับ 1',
  statusApproved: 'อนุมัติแล้ว (พร้อมบันทึก)',
  // 复核
  approve: 'อนุมัติ',
  reject: 'ปฏิเสธ',
  approveSuccess: 'อนุมัติสำเร็จ',
  rejectSuccess: 'ปฏิเสธแล้ว เอกสารกลับไปตรวจสอบใหม่',
  level: 'ระดับตรวจทาน',
  // 批量更正
  batchSubmit: 'บันทึกทั้งหมด',
  supplierName: 'ชื่อผู้ขาย',
  newValuePlaceholder: 'ค่าใหม่',
};

/** 在单据列表/详情中定位某编号所在行。 */
function rowOf(docNumber: string): HTMLElement {
  const cell = screen.getByText(docNumber);
  return cell.closest('tr') as HTMLElement;
}

/** 打开详情（列表点击），等待并排视图渲染。 */
async function openDetail(docNumber: string): Promise<void> {
  const row = rowOf(docNumber);
  await userEvent.click(within(row).getByRole('button', { name: TH.openDetail }));
  await waitFor(() => expect(screen.getByText(TH.originalImage)).toBeInTheDocument(), WAIT);
}

/** 找到某字段标签（必填带 *）所在 FieldRow 中的输入框。标签需行首锚定，避免匹配待处理清单文本。 */
function fieldInput(fieldLabelRegex: RegExp): HTMLInputElement {
  const label = screen.getByText(fieldLabelRegex);
  const row = label.closest('div.ant-row') as HTMLElement;
  return within(row).getByRole('textbox') as HTMLInputElement;
}

/** 打开 antd Select 并选择选项。 */
async function pickSelectOption(optionText: string): Promise<void> {
  const selector = document.querySelector('.ant-select-selector') as HTMLElement;
  fireEvent.mouseDown(selector);
  const option = await waitFor(() => {
    const dropdown = document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)');
    expect(dropdown).toBeTruthy();
    return within(dropdown as HTMLElement).getByText(optionText);
  }, WAIT);
  fireEvent.click(option);
}

describe('并排核验视图（verification-workbench spec）', () => {
  it('列表展示待核验单据，打开详情可见原图/字段/行项目/置信度', async () => {
    await loginAndOpen('clerk1', '/verification');
    // 待核验 = extracted + in_review：doc-ex-01/02 + doc-ir-01..04
    for (const docNumber of ['INV-2026-103', 'DN-2026-102', 'INV-2026-001', 'INV-2026-002', 'INV-2026-003', 'PO-2026-001']) {
      expect(screen.getByText(docNumber)).toBeInTheDocument();
    }
    await openDetail('INV-2026-001');
    // 左侧原图（Mock samples SVG；图标 span 也有 img role，按 alt 过滤）
    const img = screen.getByRole('img', { name: 'INV-2026-001' }) as HTMLImageElement;
    expect(img.getAttribute('src')).toContain('INV-2026-001');
    // 右侧头部字段 + 行项目 + 置信度
    expect(screen.getByText(TH.headerFields)).toBeInTheDocument();
    expect(screen.getByText(/^ยอดรวม/)).toBeInTheDocument();
    expect(screen.getByText(TH.lineItems)).toBeInTheDocument();
    expect(screen.getAllByText(/ความมั่นใจ \d+%/).length).toBeGreaterThan(0);
  });

  it('行项目表与原图同屏：两者同属一个 Row 容器（sticky 左图 + 右栏行项目，ADR-003）', async () => {
    await loginAndOpen('clerk1', '/verification?doc=doc-ir-01');
    await waitFor(() => expect(screen.getByText(TH.originalImage)).toBeInTheDocument(), WAIT);
    const imageCard = screen.getByText(TH.originalImage).closest('.ant-card') as HTMLElement;
    const lineItemsCard = screen.getByText(TH.lineItems).closest('.ant-card') as HTMLElement;
    // 原图 Card 与行项目 Card 的共同祖先 Row：保证行项目与原图同屏可见（jsdom 无法断言 sticky 视觉效果）
    const layoutRow = imageCard.closest('.ant-row') as HTMLElement;
    expect(layoutRow).toBeTruthy();
    expect(layoutRow.contains(lineItemsCard)).toBe(true);
    // 行项目表在右栏渲染（存在数据行）
    expect(lineItemsCard.querySelectorAll('.ant-table-tbody .ant-table-row').length).toBeGreaterThan(0);
  });

  it('编辑 total_price 后变更日志新增记录（前后值/用户/时间）', async () => {
    await loginAndOpen('clerk1', '/verification?doc=doc-ir-01');
    await waitFor(() => expect(screen.getByText(TH.originalImage)).toBeInTheDocument(), WAIT);
    const input = fieldInput(/^ยอดรวม/);
    expect(input.value).toBe('12500.00');
    fireEvent.change(input, { target: { value: '13000.00' } });
    // 保存按钮带图标，可访问名为 "check บันทึก"，用后缀正则匹配
    await userEvent.click(screen.getByRole('button', { name: /บันทึก$/ }));
    await waitFor(() => expect(screen.getByText(TH.saved)).toBeInTheDocument(), WAIT);
    expect(fieldInput(/^ยอดรวม/).value).toBe('13000.00');
    // 变更日志列表
    await userEvent.click(screen.getByRole('button', { name: TH.changeLogs }));
    const drawer = document.querySelector('.ant-drawer-content') as HTMLElement;
    await waitFor(() => expect(within(drawer).getByText('total_price')).toBeInTheDocument(), WAIT);
    expect(within(drawer).getByText('12500.00')).toBeInTheDocument();
    expect(within(drawer).getByText('13000.00')).toBeInTheDocument();
    expect(within(drawer).getAllByText(/Somchai W\./).length).toBeGreaterThan(0);
  }, 45000);

  it('低置信度字段红色标记与必填缺失提醒（负样例）', async () => {
    await loginAndOpen('clerk1', '/verification?doc=doc-ir-03');
    await waitFor(() => expect(screen.getByText(TH.originalImage)).toBeInTheDocument(), WAIT);
    // total_price 置信度 0.62 → 红色"需人工确认"标记 + 待处理清单 + 红框输入
    expect(screen.getAllByText(TH.needsReview).length).toBeGreaterThan(0);
    expect(screen.getByText(TH.pendingAlertTitle)).toBeInTheDocument();
    // antd status="error" 通过 class 呈现红框
    expect(fieldInput(/^ยอดรวม/)).toHaveClass('ant-input-status-error');

    // doc-ir-02：invoice_number 必填缺失
    navigateWithinApp('/verification?doc=doc-ir-02');
    await waitFor(() => expect(screen.getAllByText(TH.missingRequired).length).toBeGreaterThan(0), WAIT);
    expect(screen.getByText(`${TH.missingRequired}: เลขที่ใบแจ้งหนี้`)).toBeInTheDocument();
  });
});

describe('确认门控与锁定（FR-VERIFY-006/009）', () => {
  it('必填缺失阻止确认并显示原因（AC-FR-VERIFY-006-01）', async () => {
    await loginAndOpen('clerk1', '/verification?doc=doc-ir-02');
    await waitFor(() => expect(screen.getByText(TH.confirm)).toBeInTheDocument(), WAIT);
    await userEvent.click(screen.getByRole('button', { name: TH.confirm }));
    await waitFor(() => expect(screen.getByText(TH.gateMissing)).toBeInTheDocument(), WAIT);
    // 状态未流转
    expect(screen.getByText(TH.statusInReview)).toBeInTheDocument();
  });

  it('金额不一致阻止确认（doc-ir-04 负样例）', async () => {
    await loginAndOpen('clerk1', '/verification?doc=doc-ir-04');
    await waitFor(() => expect(screen.getByText(TH.confirm)).toBeInTheDocument(), WAIT);
    await userEvent.click(screen.getByRole('button', { name: TH.confirm }));
    await waitFor(() => expect(screen.getByText(TH.gateMismatch)).toBeInTheDocument(), WAIT);
    expect(screen.getByText(TH.statusInReview)).toBeInTheDocument();
  });

  it('确认后按复核级别流转并锁定只读（AC-FR-VERIFY-006-02）', async () => {
    // INVOICE 配置为 2 级 → 确认后进入 pending_review_level_1
    await loginAndOpen('clerk1', '/verification?doc=doc-ir-01');
    await waitFor(() => expect(screen.getByText(TH.confirm)).toBeInTheDocument(), WAIT);
    await userEvent.click(screen.getByRole('button', { name: TH.confirm }));
    await waitFor(() => expect(screen.getByText(TH.confirmSuccess)).toBeInTheDocument(), WAIT);
    expect(screen.getByText(TH.statusPendingL1)).toBeInTheDocument();
    // 字段全部只读
    const inputs = screen.getAllByRole('textbox') as HTMLInputElement[];
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) {
      expect(input).toBeDisabled();
    }
  });

  it('0 级复核（Delivery Note）确认后直接 approved_for_business', async () => {
    await loginAndOpen('clerk1', '/verification?doc=doc-ex-02');
    await waitFor(() => expect(screen.getByText(TH.confirm)).toBeInTheDocument(), WAIT);
    await userEvent.click(screen.getByRole('button', { name: TH.confirm }));
    await waitFor(() => expect(screen.getByText(TH.statusApproved)).toBeInTheDocument(), WAIT);
  });
});

describe('0/1/2 级复核流程（FR-VERIFY-010/011/012/013）', () => {
  it('一级通过后二级单据仍待复核，复核记录可见', async () => {
    await loginAndOpen('reviewer1', '/review');
    // doc-pr-01（INV，配置 2 级）目前待一级
    await waitFor(() => expect(screen.getByText('INV-2026-010')).toBeInTheDocument(), WAIT);
    const row = rowOf('INV-2026-010');
    // 行内按钮带图标（可访问名含 aria-label 前缀），用后缀正则匹配
    await userEvent.click(within(row).getByRole('button', { name: /อนุมัติ$/ }));
    const modal = document.querySelector('.ant-modal') as HTMLElement;
    await waitFor(() => expect(modal).toBeInTheDocument(), WAIT);
    await userEvent.click(within(modal).getByRole('button', { name: TH.approve }));
    await waitFor(() => expect(screen.getByText(TH.approveSuccess)).toBeInTheDocument(), WAIT);
    // 仍处于二级待复核：行还在，级别标签为 2
    const rowAfter = rowOf('INV-2026-010');
    expect(within(rowAfter).getByText(`${TH.level} 2`)).toBeInTheDocument();
    // 复核记录新增条目（级别/复核人/决定/时间）；按钮带图标，用后缀正则
    await userEvent.click(within(rowAfter).getByRole('button', { name: /บันทึกการตรวจทาน$/ }));
    const drawer = document.querySelector('.ant-drawer-content') as HTMLElement;
    await waitFor(() => expect(within(drawer).getAllByText(TH.approve).length).toBeGreaterThan(0), WAIT);
    expect(within(drawer).getAllByText(/Anucha Review/).length).toBeGreaterThan(0);
  }, 45000);

  it('二级通过 → approved_for_business，离开待复核列表', async () => {
    await loginAndOpen('reviewer1', '/review');
    await waitFor(() => expect(screen.getByText('INV-2026-011')).toBeInTheDocument(), WAIT);
    const row = rowOf('INV-2026-011');
    await userEvent.click(within(row).getByRole('button', { name: /อนุมัติ$/ }));
    const modal = document.querySelector('.ant-modal') as HTMLElement;
    await waitFor(() => expect(modal).toBeInTheDocument(), WAIT);
    await userEvent.click(within(modal).getByRole('button', { name: TH.approve }));
    await waitFor(() => expect(screen.getByText(TH.approveSuccess)).toBeInTheDocument(), WAIT);
    await waitFor(() => expect(screen.queryByText('INV-2026-011')).not.toBeInTheDocument(), WAIT);
  });

  it('拒绝打回：意见保留、字段恢复可编辑、重新提交生成新待复核记录', async () => {
    await loginAndOpen('reviewer1', '/review');
    await waitFor(() => expect(screen.getByText('RCPT-2026-002')).toBeInTheDocument(), WAIT);
    const row = rowOf('RCPT-2026-002');
    await userEvent.click(within(row).getByRole('button', { name: /ปฏิเสธ$/ }));
    const modal = document.querySelector('.ant-modal') as HTMLElement;
    await waitFor(() => expect(modal).toBeInTheDocument(), WAIT);
    const comment = within(modal).getByRole('textbox');
    await userEvent.type(comment, 'จำนวนเงินไม่ตรงกับใบแจ้งหนี้');
    await userEvent.click(within(modal).getByRole('button', { name: TH.reject }));
    await waitFor(() => expect(screen.getByText(TH.rejectSuccess)).toBeInTheDocument(), WAIT);
    await waitFor(() => expect(screen.queryByText('RCPT-2026-002')).not.toBeInTheDocument(), WAIT);

    // 换 clerk1 登录（同一 App 实例/store）：单据回到 in_review，字段可编辑，意见在复核记录中
    await logout();
    await userEvent.type(document.querySelector('#username')!, 'clerk1');
    await userEvent.type(document.querySelector('#password')!, 'clerk1');
    await userEvent.click(screen.getByRole('button', { name: 'เข้าสู่ระบบ' }));
    await waitFor(() => expect(window.location.pathname).not.toBe('/login'), WAIT);
    navigateWithinApp('/verification?doc=doc-pr-02');
    await waitFor(() => expect(screen.getByText(TH.statusInReview)).toBeInTheDocument(), WAIT);
    const inputs = screen.getAllByRole('textbox');
    expect(inputs.length).toBeGreaterThan(0);
    for (const input of inputs) {
      expect(input).toBeEnabled();
    }
    await userEvent.click(screen.getByRole('button', { name: TH.reviewRecords }));
    const drawer = document.querySelector('.ant-drawer-content') as HTMLElement;
    await waitFor(() => expect(within(drawer).getByText(TH.reject)).toBeInTheDocument(), WAIT);
    expect(within(drawer).getByText('จำนวนเงินไม่ตรงกับใบแจ้งหนี้')).toBeInTheDocument();

    // 重新提交 → 新的待复核记录（pending_review_level_1）
    await userEvent.click(screen.getByRole('button', { name: TH.confirm }));
    await waitFor(() => expect(screen.getByText(TH.statusPendingL1)).toBeInTheDocument(), WAIT);
  }, 60000);
});

describe('跨文档批量更正（P1，FR-VERIFY-003）', () => {
  it('3 份单据批量改 supplier_name，字段更新且各新增变更日志', async () => {
    await loginAndOpen('clerk1', '/verification/batch');
    await waitFor(() => expect(screen.getByText('INV-2026-103')).toBeInTheDocument(), WAIT);
    // 选 3 份 INVOICE（同类才能共享字段）
    for (const docNumber of ['INV-2026-103', 'INV-2026-001', 'INV-2026-002']) {
      const row = rowOf(docNumber);
      await userEvent.click(within(row).getByRole('checkbox'));
    }
    await pickSelectOption(TH.supplierName);
    const valueInput = screen.getByPlaceholderText(TH.newValuePlaceholder);
    await userEvent.type(valueInput, 'ACME Trading Partner Ltd.');
    await userEvent.click(screen.getByRole('button', { name: TH.batchSubmit }));
    await waitFor(() => expect(screen.getByText('แก้ไข 3 เอกสารแล้ว')).toBeInTheDocument(), WAIT);

    // 同一 store 内检查：字段已更新 + 变更日志逐单新增
    navigateWithinApp('/verification?doc=doc-ex-01');
    await waitFor(() => expect(screen.getByDisplayValue('ACME Trading Partner Ltd.')).toBeInTheDocument(), WAIT);
    await userEvent.click(screen.getByRole('button', { name: TH.changeLogs }));
    const drawer = document.querySelector('.ant-drawer-content') as HTMLElement;
    await waitFor(() => expect(within(drawer).getByText('supplier_name')).toBeInTheDocument(), WAIT);
  }, 45000);
});
