import { useSession, type CurrentTenant } from "../../stores/session";

/** The tenant pages act on. Task 4 stub: the personal (or guest) tenant; tenant switching
 * and its persistence replace this in Task 5. */
export function useCurrentTenant(): { tenant: CurrentTenant | null; setTenant(id: number): void } {
  const me = useSession((s) => s.me);
  const tenants = useSession((s) => s.tenants);
  const own = tenants.find((t) => t.tenant_id === me?.tenant_id);
  const tenant: CurrentTenant | null = me
    ? (own ?? {
        tenant_id: me.tenant_id,
        kind: me.kind === "guest" ? "guest" : "personal",
        name: null,
        is_owner: true,
        role: null,
        permissions: [],
      })
    : null;
  return { tenant, setTenant: () => {} };
}
