import { createContext, useContext, useMemo } from 'react';
import type { ReactNode } from 'react';
import { useApiClient, useMockStoreState } from '../api/context';
import type { Session } from '../api/types';
import { permissionsFor, type Permissions } from '../mock/users';

/**
 * 会话上下文：会话态存于 mock store（localStorage 持久化，刷新不丢），
 * 登录/退出经 ApiClient 执行。接入真实后端时仅需替换 ApiClient 实现。
 */
export interface AuthContextValue {
  session: Session | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  permissions: Permissions | null;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const api = useApiClient();
  const storeState = useMockStoreState();
  const session = storeState?.session ?? null;

  const value = useMemo<AuthContextValue>(
    () => ({
      session,
      login: async (username, password) => {
        await api.login(username, password);
      },
      logout: async () => {
        await api.logout();
      },
      permissions: session ? permissionsFor(session.user.roles) : null,
    }),
    [api, session],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider is missing');
  return value;
}
