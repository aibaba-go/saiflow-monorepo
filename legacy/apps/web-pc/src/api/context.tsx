import { createContext, useContext, useMemo, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { ApiClient } from './ApiClient';
import { MockApiClient } from './MockApiClient';
import type { MockStoreState } from '../mock/store';
import { buildInitialData } from '../mock/dataset';
import { MockStore } from '../mock/store';

/**
 * ApiClient Provider 注入点（design.md 决策 2 / ADR-002）。
 * `VITE_USE_MOCK=false` 时切换为真实客户端（当前仅有 Mock 实现）。
 */
const ApiClientContext = createContext<ApiClient | null>(null);

export function ApiClientProvider({ children }: { children: ReactNode }) {
  const client = useMemo(() => {
    const useMock = import.meta.env.VITE_USE_MOCK !== 'false';
    if (!useMock) {
      // 真实客户端尚未就绪（后端 OpenAPI 契约未生成），暂回落 Mock 并提示
      console.warn('[saiflow] VITE_USE_MOCK=false but no RealApiClient yet; falling back to mock.');
    }
    return new MockApiClient(new MockStore(buildInitialData())) as ApiClient;
  }, []);

  return <ApiClientContext.Provider value={client}>{children}</ApiClientContext.Provider>;
}

export function useApiClient(): ApiClient {
  const client = useContext(ApiClientContext);
  if (!client) throw new Error('ApiClientProvider is missing');
  return client;
}

/** 订阅 mock store 的响应式状态（仅 Mock 模式可用；真实客户端下应改用网络层缓存）。 */
export function useMockStoreState(): MockStoreState | null {
  const client = useContext(ApiClientContext);
  const mockClient = client instanceof MockApiClient ? client : null;
  const store = mockClient?.mockStore ?? null;

  const subscribe = useMemo(() => (store ? (listener: () => void) => store.subscribe(listener) : undefined), [store]);
  const getSnapshot = useMemo(() => (store ? () => store.getState() : undefined), [store]);

  const state = useSyncExternalStore(
    subscribe ?? (() => () => undefined),
    getSnapshot ?? (() => null),
    () => null,
  );
  return state;
}
