import { useMe } from "../auth/session";
import { useCurrentTenant } from "./useCurrentTenant";

/** The current tenant of the signed-in user. */
export function useTenant() {
  const me = useMe();
  return useCurrentTenant(me.data);
}
