import { render, screen } from '@testing-library/react';
import App from './App';

describe('smoke', () => {
  it('renders the login page when not authenticated', async () => {
    render(<App />);
    // 默认泰语资源包已加载（登录页标题在三种语言下均含 SaiFlow）
    expect(await screen.findByText(/SaiFlow/)).toBeInTheDocument();
  });
});
