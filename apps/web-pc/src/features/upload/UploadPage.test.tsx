import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { fireEvent } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import App from '../../App';
import { validateUploadFile } from './validate';

const TH = {
  loginTitle: 'เข้าสู่ระบบ SaiFlow',
  submit: 'เข้าสู่ระบบ',
  uploadTitle: 'อัปโหลดเอกสาร',
  queue: 'คิวอัปโหลด',
};

const WAIT = { timeout: 8000 };

async function loginAndOpenUpload(): Promise<void> {
  render(<App />);
  await waitFor(() => screen.findByText(TH.loginTitle), WAIT);
  await userEvent.type(document.querySelector('#username')!, 'clerk1');
  await userEvent.type(document.querySelector('#password')!, 'clerk1');
  await userEvent.click(screen.getByRole('button', { name: TH.submit }));
  await waitFor(() => expect(window.location.pathname).not.toBe('/login'), WAIT);
  window.history.pushState({}, '', '/upload');
  fireEvent(window, new PopStateEvent('popstate'));
  await waitFor(() => expect(screen.getAllByText(TH.uploadTitle).length).toBeGreaterThan(0), WAIT);
}

/** 直接向 antd Upload 的原生 input 注入文件并触发 change。 */
function pushFiles(files: File[]): void {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  Object.defineProperty(input, 'files', { value: files });
  fireEvent.change(input);
}

describe('文件导入与格式校验（upload-queue spec）', () => {
  it('拒绝 .docx：显示本地化错误且不入队', async () => {
    await loginAndOpenUpload();
    const before = screen.getAllByRole('row').length;
    pushFiles([new File(['x'], 'invoice.docx', { type: 'application/msword' })]);
    await waitFor(
      () => expect(screen.getByText('ประเภทไฟล์ไม่รองรับ (รองรับเฉพาะ JPG / PNG / PDF)')).toBeInTheDocument(),
      WAIT,
    );
    expect(screen.getAllByRole('row').length).toBe(before);
  });

  it('拒绝超过 20 MB 的文件：提示大小超限且不入队', async () => {
    await loginAndOpenUpload();
    const before = screen.getAllByRole('row').length;
    const bigFile = new File([new Uint8Array(21 * 1024 * 1024)], 'big.png', { type: 'image/png' });
    pushFiles([bigFile]);
    await waitFor(
      () => expect(screen.getByText('ไฟล์มีขนาดเกิน 20 MB')).toBeInTheDocument(),
      WAIT,
    );
    expect(screen.getAllByRole('row').length).toBe(before);
  });

  it('支持的文件入队并进入上传流程', async () => {
    await loginAndOpenUpload();
    pushFiles([new File([new Uint8Array(1024)], 'INV-2026-301.pdf', { type: 'application/pdf' })]);
    await waitFor(() => expect(screen.getByText('INV-2026-301.pdf')).toBeInTheDocument(), WAIT);
    // 状态出现在队列中（排队中/上传中/… 任一处理中状态）
    await waitFor(
      () => {
        const statuses = ['รอคิว', 'กำลังอัปโหลด', 'กำลังประมวลผลล่วงหน้า', 'กำลังประมวลผล OCR', 'เสร็จสิ้น'];
        expect(statuses.some((s) => screen.getAllByText(s).length > 0)).toBe(true);
      },
      WAIT,
    );
  });
});

describe('validateUploadFile 纯逻辑', () => {
  it('jpg/png/pdf 均放行', () => {
    for (const name of ['a.jpg', 'a.jpeg', 'a.png', 'a.pdf']) {
      expect(validateUploadFile({ name, size: 1024 })).toEqual({ ok: true });
    }
  });
  it('无扩展名拒绝', () => {
    expect(validateUploadFile({ name: 'noext', size: 10 })).toEqual({
      ok: false,
      reason: 'unsupported_file_type',
    });
  });
});
