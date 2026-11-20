import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { loginAndOpen, WAIT } from '../../test-utils/app';
import type { DocumentType } from '../../api/types';

const TH = {
  search: 'ค้นหา',
  openPreview: 'ดูตัวอย่าง',
  noMatch: 'ไม่พบเอกสารที่ตรงกับเงื่อนไข',
  invoiceType: 'ใบแจ้งหนี้ (Invoice)',
  dateFrom: 'วันที่เริ่มต้น',
  dateTo: 'วันที่สิ้นสุด',
  originalImage: 'ภาพต้นฉบับ',
  extractedData: 'ข้อมูลที่สกัด',
  fileName: 'ชื่อไฟล์เก็บถาวร',
  changeLogs: 'บันทึกการเปลี่ยนแปลง',
  reviewRecords: 'บันทึกการตรวจทาน',
  approve: 'อนุมัติ',
};

const DOC_TYPE_TH: Record<DocumentType, string> = {
  INVOICE: 'ใบแจ้งหนี้ (Invoice)',
  DELIVERY_NOTE: 'ใบส่งของ (Delivery Note)',
  PO: 'ใบสั่งซื้อ (PO)',
  RECEIPT: 'ใบเสร็จรับเงิน (Receipt)',
};

function rowOf(docNumber: string): HTMLElement {
  const cell = screen.getByText(docNumber);
  return cell.closest('tr') as HTMLElement;
}

/** 当前列表中的数据行数（分页断言用）。 */
function rowCount(): number {
  return document.querySelectorAll('.ant-table-tbody .ant-table-row').length;
}

/** 在唯一的类型下拉框中选择一个类型选项。 */
async function pickDocType(type: DocumentType): Promise<void> {
  const selector = document.querySelector('.ant-select-selector') as HTMLElement;
  fireEvent.mouseDown(selector);
  await waitFor(
    () => expect(document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)')).toBeTruthy(),
    WAIT,
  );
  const dropdown = document.querySelector('.ant-select-dropdown:not(.ant-select-dropdown-hidden)') as HTMLElement;
  await userEvent.click(within(dropdown).getByText(DOC_TYPE_TH[type]));
}

/** 设置一个筛选输入框的值（按占位符定位）。 */
function setFilter(placeholder: string, value: string): void {
  fireEvent.change(screen.getByPlaceholderText(placeholder), { target: { value } });
}

async function search(): Promise<void> {
  await userEvent.click(screen.getByRole('button', { name: /ค้นหา$/ }));
}

describe('归档列表：分类浏览与分页（FR-MGMT-001）', () => {
  it('默认列表展示第 1 页 20 条，翻页后展示第 2 页剩余记录', async () => {
    await loginAndOpen('viewer1', '/archive');
    // 种子数据 25 份已归档单据 → 第 1 页 20 条
    await waitFor(() => expect(screen.getByText('DN-2026-004')).toBeInTheDocument(), WAIT);
    expect(rowCount()).toBe(20);
    expect(screen.getByText('INV-2026-014')).toBeInTheDocument();

    // 点击下一页 → 第 2 页 5 条
    const next = document.querySelector('.ant-pagination-next') as HTMLElement;
    await userEvent.click(next);
    await waitFor(() => expect(screen.getByText('INV-2026-201')).toBeInTheDocument(), WAIT);
    expect(rowCount()).toBe(5);
  }, 45000);

  it('按类型 Invoice 浏览：仅显示 Invoice 归档单据', async () => {
    await loginAndOpen('viewer1', '/archive');
    await waitFor(() => expect(screen.getByText('DN-2026-004')).toBeInTheDocument(), WAIT);
    await pickDocType('INVOICE');
    await search();
    // 非Invoice 类型的归档单据不再出现
    await waitFor(() => expect(screen.queryByText('DN-2026-004')).not.toBeInTheDocument(), WAIT);
    expect(screen.queryByText('RCPT-2026-004')).not.toBeInTheDocument();
    expect(screen.getByText('INV-2026-014')).toBeInTheDocument();
    // 所有可见行均为 Invoice 类型
    const rows = Array.from(document.querySelectorAll('.ant-table-tbody .ant-table-row')) as HTMLElement[];
    for (const row of rows) {
      expect(within(row).getByText(DOC_TYPE_TH.INVOICE)).toBeInTheDocument();
    }
  }, 45000);
});

describe('文档预览（FR-MGMT-006）', () => {
  it('打开预览：原图与提取数据并排，可查看变更/复核日志', async () => {
    await loginAndOpen('viewer1', '/archive');
    await waitFor(() => expect(screen.getByText('INV-2026-014')).toBeInTheDocument(), WAIT); // doc-ar-01
    await userEvent.click(within(rowOf('INV-2026-014')).getByRole('button', { name: TH.openPreview }));

    // 并排展示原图与提取数据，且带归档文件名信息
    await waitFor(() => expect(screen.getByText(TH.originalImage)).toBeInTheDocument(), WAIT);
    expect(screen.getByText(TH.extractedData)).toBeInTheDocument();
    expect(screen.getByText(TH.fileName)).toBeInTheDocument();
    expect(screen.getByRole('img', { name: 'INV-2026-014' })).toBeInTheDocument();
    // 提取数据区展示字段值（doc-ar-01 的供应商字段已人工修正）
    expect(screen.getByText('ACME Manufacturing Co., Ltd.')).toBeInTheDocument();

    // 行项目与原图同屏：两者同属一个 Row 容器（sticky 左图 + 右栏行项目，ADR-003），且预览展示行项目数据
    const imageCard = screen.getByText(TH.originalImage).closest('.ant-card') as HTMLElement;
    const lineItemsCard = screen.getByText('รายการสินค้า').closest('.ant-card') as HTMLElement;
    const layoutRow = imageCard.closest('.ant-row') as HTMLElement;
    expect(layoutRow).toBeTruthy();
    expect(layoutRow.contains(lineItemsCard)).toBe(true);
    // doc-ar-01（INVOICE，编号末位 1）→ 3 行行项目
    expect(lineItemsCard.querySelectorAll('.ant-table-tbody .ant-table-row').length).toBe(3);

    // 变更日志：doc-ar-01 有 supplier_name 修正记录
    await userEvent.click(screen.getByRole('button', { name: TH.changeLogs }));
    const logDrawer = document.querySelector('.ant-drawer-content') as HTMLElement;
    await waitFor(() => expect(within(logDrawer).getByText('supplier_name')).toBeInTheDocument(), WAIT);
    expect(within(logDrawer).getByText('ACME Manufacturing Co., Ltd.')).toBeInTheDocument();
    fireEvent.click(document.querySelector('.ant-drawer-close') as HTMLElement);

    // 复核记录：INVOICE 两级通过轨迹（关闭的抽屉仍挂在 DOM，取最后一个即当前打开者）
    await userEvent.click(screen.getByRole('button', { name: TH.reviewRecords }));
    const drawerContents = document.querySelectorAll('.ant-drawer-content');
    const reviewDrawer = drawerContents[drawerContents.length - 1] as HTMLElement;
    await waitFor(() => expect(within(reviewDrawer).getAllByText(TH.approve).length).toBeGreaterThan(0), WAIT);
  }, 45000);
});

describe('组合搜索（P1：FR-MGMT-002/003/004/005）', () => {
  it('按编号检索：仅返回匹配单据', async () => {
    await loginAndOpen('viewer1', '/archive');
    await waitFor(() => expect(screen.getByText('INV-2026-014')).toBeInTheDocument(), WAIT);
    setFilter('เลขที่เอกสาร', 'INV-2026-014');
    await search();
    await waitFor(() => expect(rowCount()).toBe(1), WAIT);
    expect(screen.getByText('INV-2026-014')).toBeInTheDocument();
    expect(screen.queryByText('DN-2026-004')).not.toBeInTheDocument();
  }, 45000);

  it('多条件 AND 组合：类型 + 企业 + 日期范围', async () => {
    await loginAndOpen('viewer1', '/archive');
    await waitFor(() => expect(screen.getByText('INV-2026-014')).toBeInTheDocument(), WAIT);
    await pickDocType('INVOICE');
    setFilter('องค์กร/ผู้ค้า', 'ACME');
    setFilter(TH.dateFrom, '2026-09-01');
    setFilter(TH.dateTo, '2026-09-30');
    await search();
    // 同时满足三条件：INV-2026-014（ACME 09-24）与 INV-2026-201（ACME 09-01）命中
    await waitFor(() => expect(screen.queryByText('RCPT-2026-004')).not.toBeInTheDocument(), WAIT);
    expect(screen.getByText('INV-2026-014')).toBeInTheDocument();
    expect(screen.getByText('INV-2026-201')).toBeInTheDocument();
    const rows = Array.from(document.querySelectorAll('.ant-table-tbody .ant-table-row')) as HTMLElement[];
    for (const row of rows) {
      expect(within(row).getByText(DOC_TYPE_TH.INVOICE)).toBeInTheDocument();
      expect(within(row).getByText(/ACME Manufacturing/)).toBeInTheDocument();
    }
  }, 45000);

  it('无结果提示：搜索不存在的编号', async () => {
    await loginAndOpen('viewer1', '/archive');
    await waitFor(() => expect(screen.getByText('INV-2026-014')).toBeInTheDocument(), WAIT);
    setFilter('เลขที่เอกสาร', 'NO-SUCH-999');
    await search();
    await waitFor(() => expect(screen.getByText(TH.noMatch)).toBeInTheDocument(), WAIT);
    expect(rowCount()).toBe(0);
  }, 45000);
});
