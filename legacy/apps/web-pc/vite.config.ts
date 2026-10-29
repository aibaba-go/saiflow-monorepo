/// <reference types="vitest" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  const isTest = mode === 'test';
  return {
    plugins: [react()],
    server: {
      port: 5173,
    },
    test: isTest
      ? {
          environment: 'jsdom',
          globals: true,
          setupFiles: ['./src/test/setup.ts'],
          // 全量 RTL 场景含真实 Mock 延迟（300–800ms），需要更宽的用例超时
          testTimeout: 20000,
        }
      : undefined,
  };
});
