// Ported from apps/line-mini/src/features/tenants/useCurrentTenant.ts (web-pc-account plan:
// copied, not shared). web-pc keeps the tenant list here too, so the request header is known.
import type { QueryClient } from "@tanstack/react-query";
import { create } from "zustand";

import { onForget, tenantKey, TENANTS_KEY, type Me, type UsableTenant } from "../auth/session";
import type { MessageKey } from "../i18n";
import { api, call, setTenantHeaderSource } from "../services/api";

const ID = /^[1-9]\d{0,17}$/;

export function readStoredTenant(userId: number): number | null {
  try {
    const raw = localStorage.getItem(tenantKey(userId));
    return raw && ID.test(raw) ? Number(raw) : null;
  } catch {
    return null;
  }
}

interface TenantState {
  /** Whose choice this is; null until the signed-in user is known. */
  userId: number | null;
  /** The chosen organization, or null for the personal tenant (FR-SYS-096). */
  id: number | null;
  /** The user's usable tenants; null until first loaded. */
  tenants: UsableTenant[] | null;
  /** A one-off message (tenant.gone), shown then cleared. */
  notice: MessageKey | null;
  choose(id: number | null): void;
  /** Load the signed-in user's stored choice (once per user). */
  bindUser(userId: number): void;
  /** A fresh list: drop a stored choice that is no longer usable (AC-096-03). */
  setTenants(list: UsableTenant[]): void;
  clearNotice(): void;
  /** Nobody bound, nothing loaded (logout, expiry, a new login, a test). */
  reset(): void;
}

export const useTenantChoice = create<TenantState>((set, get) => ({
  userId: null,
  id: null,
  tenants: null,
  notice: null,
  choose(id) {
    const { userId } = get();
    try {
      if (userId !== null && id === null) localStorage.removeItem(tenantKey(userId));
      else if (userId !== null) localStorage.setItem(tenantKey(userId), String(id));
    } catch {
      // storage blocked: the choice lasts for this visit only
    }
    set({ id });
  },
  setTenants(list) {
    const { id, choose } = get();
    set({ tenants: list });
    if (id !== null && !list.some((t) => t.tenant_id === id && t.kind === "organization")) {
      choose(null);
      set({ notice: "tenant.gone" });
    }
  },
  bindUser(userId) {
    if (get().userId === userId) return;
    set({ userId, id: readStoredTenant(userId), tenants: null, notice: null });
  },
  clearNotice: () => set({ notice: null }),
  reset: () => set({ userId: null, id: null, tenants: null, notice: null }),
}));

onForget(() => useTenantChoice.getState().reset());

export type CurrentTenant = UsableTenant;

export function resolveTenant(me: Me | null | undefined, tenants: UsableTenant[], chosen: number | null): CurrentTenant | null {
  if (!me) return null;
  const org = chosen === null ? undefined : tenants.find((t) => t.tenant_id === chosen);
  if (org && org.kind === "organization") return org;
  return (
    tenants.find((t) => t.tenant_id === me.tenant_id) ?? {
      tenant_id: me.tenant_id,
      kind: "personal",
      name: null,
      is_owner: true,
      role: null,
      permissions: [],
    }
  );
}

/** The organization the requests act on, or null for the own tenant (no header). */
export function currentOrgId(): number | null {
  const { id, tenants } = useTenantChoice.getState();
  if (id === null || !tenants) return null;
  return tenants.some((t) => t.tenant_id === id && t.kind === "organization") ? id : null;
}

setTenantHeaderSource(currentOrgId);

/** Re-read the tenants (each time the switcher opens, AC-096-02); a failure keeps the list. */
export async function refreshTenants(queryClient: QueryClient): Promise<void> {
  try {
    const list = await queryClient.fetchQuery({
      queryKey: TENANTS_KEY,
      queryFn: (): Promise<UsableTenant[]> => call(api.GET("/api/v1/me/tenants")),
      staleTime: 0,
    });
    useTenantChoice.getState().setTenants(list);
  } catch {
    // keep the list already shown; a 401 goes through the session handler
  }
}

/** The current tenant for the pages, and the switch (FR-SYS-096). */
export function useCurrentTenant(me: Me | null | undefined): {
  tenant: CurrentTenant | null;
  tenants: UsableTenant[];
  setTenant(id: number | null): void;
} {
  const tenants = useTenantChoice((s) => s.tenants) ?? [];
  const chosen = useTenantChoice((s) => s.id);
  const choose = useTenantChoice((s) => s.choose);
  return { tenant: resolveTenant(me, tenants, chosen), tenants, setTenant: choose };
}
