/** Who is signed in (FR-SYS-090): GET /me, null without a session. A guest may use only
 * Home, Upload and Verify, so useMe() stays user-only and useIdentity() includes guests. */
import { useQuery, type QueryClient } from "@tanstack/react-query";
import { create } from "zustand";

import { api, call } from "../services/api";
import { ApiError } from "../services/errors";
import type { Me, UsableTenant } from "../types";

export type { Me, UsableTenant } from "../types";

export const ME_KEY = ["me"] as const;
export const TENANTS_KEY = ["me", "tenants"] as const;
/** The current tenant is kept per user (A8, AC-090-04): an expiry keeps it for the same
 * user's next login; another user on this browser never sees it. */
export const tenantKey = (userId: number) => `saiflow.pc.tenant.${userId}`;

export async function fetchIdentity(): Promise<Me | null> {
  try {
    return await call(api.GET("/api/v1/me"), { own401: true });
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) return null;
    throw error;
  }
}

const userOnly = (me: Me | null) => (me?.kind === "user" ? me : null);

/** The signed-in user, null for a guest or no session. */
export function useMe() {
  return useQuery({ queryKey: ME_KEY, queryFn: fetchIdentity, staleTime: 30_000, select: userOnly });
}

/** The signed-in user or the guest, null without a session. */
export function useIdentity() {
  return useQuery({ queryKey: ME_KEY, queryFn: fetchIdentity, staleTime: 30_000 });
}

export async function startGuest(queryClient: QueryClient): Promise<Me> {
  const me = await call(api.POST("/api/v1/auth/guest"), { own401: true });
  queryClient.setQueryData(ME_KEY, me);
  return me;
}

export function useMyTenants(enabled = true) {
  return useQuery({
    queryKey: TENANTS_KEY,
    queryFn: (): Promise<UsableTenant[]> => call(api.GET("/api/v1/me/tenants")),
    enabled,
  });
}

/** A one-off notice for the login page: the session expired (AC-090-04). */
export const useSessionNotice = create<{ expired: boolean; setExpired(v: boolean): void }>((set) => ({
  expired: false,
  setExpired: (expired) => set({ expired }),
}));

/** Listeners that reset per-user state kept outside React Query (the tenant choice). */
const resetters = new Set<() => void>();
export function onForget(reset: () => void): () => void {
  resetters.add(reset);
  return () => resetters.delete(reset);
}

/** Drop everything of the user who was signed in (A8): page data and the tenant state.
 * Logout also drops the user's stored tenant; an expiry or a new login keeps it, since it
 * is keyed by user (AC-090-04). */
export function forgetSession(queryClient: QueryClient, { dropTenant = false } = {}): void {
  const userId = queryClient.getQueryData<Me | null>(ME_KEY)?.user_id;
  queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== ME_KEY[0] || q.queryKey.length > 1 });
  queryClient.setQueryData(ME_KEY, null);
  if (dropTenant && userId) {
    try {
      localStorage.removeItem(tenantKey(userId));
    } catch {
      // storage blocked: nothing was stored
    }
  }
  for (const reset of resetters) reset();
}

/** End the session on the backend; the page forgets the user whatever the answer (AC-092-01). */
export async function logout(queryClient: QueryClient): Promise<void> {
  try {
    await call(api.POST("/api/v1/auth/logout"), { own401: true });
  } catch {
    // the session is forgotten locally anyway
  }
  forgetSession(queryClient, { dropTenant: true });
}
