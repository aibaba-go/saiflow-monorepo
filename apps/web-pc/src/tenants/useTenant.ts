import { useIdentity } from "../auth/session";
import { useCurrentTenant } from "./useCurrentTenant";

/** The current tenant of the signed-in user, or the guest's own tenant (FR-SYS-090). */
export function useTenant() {
  const me = useIdentity();
  return useCurrentTenant(me.data);
}
