import { useCallback } from "react";

import { useSession } from "../../stores/session";
import { startLogin } from "./session";

/** Guard for actions that need a registered user (FR-SYS-042-04): a guest is sent to LINE
 * login, an unregistered user gets the registration dialog; both return false. */
export function useRequireRegistered(): () => boolean {
  return useCallback(() => {
    const { me, set } = useSession.getState();
    if (me?.kind === "user" && me.registered) return true;
    if (me?.kind === "user") set({ registerOpen: true });
    else void startLogin();
    return false;
  }, []);
}
