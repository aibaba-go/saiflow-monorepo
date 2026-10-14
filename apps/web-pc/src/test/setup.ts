import '@testing-library/jest-dom/vitest';

// jsdom 缺少 matchMedia，AntD 组件依赖时的最小 polyfill
if (typeof window !== 'undefined' && !window.matchMedia) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: (query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }),
  });
}

// 每个测试用例之间清空 localStorage，避免会话/语言串扰
beforeEach(() => {
  window.localStorage.clear();
});
