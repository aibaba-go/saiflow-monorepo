import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from '../App';

export const WAIT = { timeout: 8000 };

const TH = {
  loginTitle: 'เข้าสู่ระบบ SaiFlow',
  submit: 'เข้าสู่ระบบ',
};

/** 在当前 jsdom 中渲染 App、登录并导航到目标路径。 */
export async function loginAndOpen(username: string, path: string): Promise<void> {
  render(<App />);
  await waitFor(() => screen.findByText(TH.loginTitle), WAIT);
  await userEvent.type(document.querySelector('#username')!, username);
  await userEvent.type(document.querySelector('#password')!, username);
  await userEvent.click(screen.getByRole('button', { name: TH.submit }));
  await waitFor(() => expect(window.location.pathname).not.toBe('/login'), WAIT);
  window.history.pushState({}, '', path);
  fireEvent(window, new PopStateEvent('popstate'));
}

/** 已登录会话内在应用内切换路径（同一 App/store 实例）。 */
export function navigateWithinApp(path: string): void {
  window.history.pushState({}, '', path);
  fireEvent(window, new PopStateEvent('popstate'));
}

/** 退出当前会话（不重渲染 App）。 */
export async function logout(): Promise<void> {
  await userEvent.click(screen.getByText('ออกจากระบบ'));
  await waitFor(() => screen.findByText(TH.loginTitle), WAIT);
}
