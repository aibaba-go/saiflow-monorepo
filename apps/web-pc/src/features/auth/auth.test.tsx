import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import App from '../../App';
import { readStoredLanguage, storeLanguage } from '../../i18n';
import { permissionsFor } from '../../mock/users';
import { NAV_ITEMS } from '../../layouts/AppLayout';

const TH = {
  loginTitle: 'เข้าสู่ระบบ SaiFlow',
  submit: 'เข้าสู่ระบบ',
  navUpload: 'อัปโหลดเอกสาร',
  navVerification: 'ตรวจสอบข้อมูล',
  navArchive: 'จัดการเอกสารเก็บถาวร',
  navSettings: 'ตั้งค่าระบบ',
  forbidden: 'ไม่มีสิทธิ์เข้าถึง',
};

const WAIT = { timeout: 8000 };

/** 登录并等待离开 /login（Mock 延迟 300–800 ms）。 */
async function login(username: string): Promise<void> {
  await waitFor(() => screen.findByText(TH.loginTitle), WAIT);
  await userEvent.type(document.querySelector('#username')!, username);
  await userEvent.type(document.querySelector('#password')!, username);
  await userEvent.click(screen.getByRole('button', { name: TH.submit }));
  await waitFor(() => expect(window.location.pathname).not.toBe('/login'), WAIT);
}

describe('登录与 Mock 会话（shell-auth）', () => {
  it('成功登录进入工作台并显示当前用户与角色', async () => {
    render(<App />);
    await login('clerk1');
    await waitFor(() => expect(screen.getByText(/Somchai W\./)).toBeInTheDocument(), WAIT);
  });

  it('未登录访问受保护页面被重定向到登录页，登录后回到原页面', async () => {
    window.history.pushState({}, '', '/verification');
    render(<App />);
    await waitFor(() => expect(screen.getByText(TH.loginTitle)).toBeInTheDocument(), WAIT);
    await login('clerk1');
    await waitFor(() => expect(window.location.pathname).toBe('/verification'), WAIT);
  });

  it('退出登录后访问受保护页面再次重定向', async () => {
    render(<App />);
    await login('clerk1');
    await waitFor(() => expect(screen.getByText(/Somchai W\./)).toBeInTheDocument(), WAIT);
    await userEvent.click(screen.getByText(/ออกจากระบบ/));
    await waitFor(() => expect(screen.getByText(TH.loginTitle)).toBeInTheDocument(), WAIT);
  });
});

describe('按角色导航（RBAC）', () => {
  it('clerk 可见上传/核验/录入归档/归档管理，不可见设置', async () => {
    render(<App />);
    await login('clerk1');
    await waitFor(() => expect(screen.getByText(TH.navUpload)).toBeInTheDocument(), WAIT);
    expect(screen.getByText(TH.navVerification)).toBeInTheDocument();
    expect(screen.getByText(TH.navArchive)).toBeInTheDocument();
    expect(screen.queryByText(TH.navSettings)).not.toBeInTheDocument();
  });

  it('viewer 不可见上传与核验入口', async () => {
    render(<App />);
    await login('viewer1');
    await waitFor(() => expect(screen.getByText(TH.navArchive)).toBeInTheDocument(), WAIT);
    expect(screen.queryByText(TH.navUpload)).not.toBeInTheDocument();
    expect(screen.queryByText(TH.navVerification)).not.toBeInTheDocument();
  });

  it('viewer 直接访问受保护路由被拦截（403）', async () => {
    window.history.pushState({}, '', '/verification');
    render(<App />);
    await login('viewer1');
    await waitFor(() => expect(screen.getByText(TH.forbidden)).toBeInTheDocument(), WAIT);
  });

  it('NAV_ITEMS 与权限矩阵一致（纯逻辑核对）', () => {
    const clerk = permissionsFor(['clerk']);
    const viewer = permissionsFor(['viewer']);
    const admin = permissionsFor(['admin']);
    for (const item of NAV_ITEMS) {
      if (item.permission) {
        expect(viewer[item.permission]).toBe(false);
      }
    }
    expect(clerk.configure).toBe(false);
    for (const item of NAV_ITEMS) {
      if (item.permission) expect(admin[item.permission]).toBe(true);
    }
  });
});

describe('UI 语言切换（shell-auth）', () => {
  it('切换语言立即生效（导航文案更新）', async () => {
    render(<App />);
    await login('clerk1');
    await waitFor(() => expect(screen.getByText(TH.navUpload)).toBeInTheDocument(), WAIT);
    await userEvent.click(screen.getByText('English'));
    await waitFor(() => expect(screen.getByText('Upload')).toBeInTheDocument(), WAIT);
    expect(screen.getAllByText('Verification').length).toBeGreaterThan(0);
  });

  it('语言偏好在会话间保留（localStorage）', () => {
    storeLanguage('zh');
    expect(window.localStorage.getItem('saiflow.web-pc.language')).toBe('zh');
    expect(readStoredLanguage()).toBe('zh');
  });

  it('无存储时初始语言回落默认泰语', () => {
    expect(readStoredLanguage()).toBe('th');
  });
});
