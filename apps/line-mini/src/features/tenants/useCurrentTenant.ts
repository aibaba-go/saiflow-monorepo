import { create } from "zustand";

import { setTenantHeaderSource } from "../../services/api";
import { useSession, type CurrentTenant, type Me, type UsableTenant } from "../../stores/session";

/** The current tenant (FR-SYS-046): kept on this device only, as a tenant ID that must still
 * be among the user's usable tenants; anything else falls back to the own tenant (A3). */
export const TENANT_KEY = "saiflow.tenant";
const ID = /^[1-9]\d{0,17}$/;

export function readStoredTenant(): number | null {
  try {
    const raw = localStorage.getItem(TENANT_KEY);
    return raw && ID.test(raw) ? Number(raw) : null;
  } catch {
    return null;
  }
}

interface TenantChoice {
  id: number | null;
  choose(id: number | null): void;
}

export const useTenantChoice = create<TenantChoice>((set) => ({
  id: readStoredTenant(),
  choose(id) {
    try {
      if (id === null) localStorage.removeItem(TENANT_KEY);
      else localStorage.setItem(TENANT_KEY, String(id));
    } catch {
      // storage blocked: the choice lasts for this visit only
    }
    set({ id });
  },
}));

function ownTenant(me: Me, tenants: UsableTenant[]): CurrentTenant {
  return (
    tenants.find((t) => t.tenant_id === me.tenant_id) ?? {
      tenant_id: me.tenant_id,
      kind: me.kind === "guest" ? "guest" : "personal",
      name: null,
      is_owner: true,
      role: null,
      permissions: [],
    }
  );
}

export function resolveTenant(
  me: Me | null,
  tenants: UsableTenant[],
  chosen: number | null,
): CurrentTenant | null {
  if (!me) return null;
  const org = chosen === null ? undefined : tenants.find((t) => t.tenant_id === chosen);
  return org && org.kind === "organization" ? org : ownTenant(me, tenants);
}

/** After the identity is (re)loaded: drop a choice that is no longer usable. */
export function reconcileTenantChoice(me: Me, tenants: UsableTenant[]): void {
  const { id, choose } = useTenantChoice.getState();
  if (id === null) return;
  const usable = tenants.some((t) => t.tenant_id === id && t.kind === "organization");
  if (usable) return;
  choose(null);
  if (me.kind === "user") useSession.getState().set({ notice: "tenant.gone" });
}

/** The organization the requests act on, or null for the own tenant (no header). */
export function currentOrgId(): number | null {
  const { me, tenants } = useSession.getState();
  const tenant = resolveTenant(me, tenants, useTenantChoice.getState().id);
  return tenant && tenant.kind === "organization" ? tenant.tenant_id : null;
}

setTenantHeaderSource(currentOrgId);

export function useCurrentTenant(): {
  tenant: CurrentTenant | null;
  setTenant(id: number | null): void;
} {
  const me = useSession((s) => s.me);
  const tenants = useSession((s) => s.tenants);
  const chosen = useTenantChoice((s) => s.id);
  const choose = useTenantChoice((s) => s.choose);
  return { tenant: resolveTenant(me, tenants, chosen), setTenant: choose };
}
