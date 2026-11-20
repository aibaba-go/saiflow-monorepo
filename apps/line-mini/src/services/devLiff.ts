import type { Liff } from "./liffTypes";

/** The reserved token the backend maps to its one fixed local dev identity, only with
 * APP_ENV=development, DEV_LOGIN_ENABLED and a loopback client (NFR-DEV-002). */
export const DEV_LOGIN_TOKEN = "saiflow-local-development";

/** A restricted local stand-in for the LIFF SDK, used only when devLoginEnabled(): no LINE
 * SDK is started and nothing is sent to LINE. It is always "logged in" with the reserved
 * token, so login goes straight to POST /api/v1/auth/line; who that is, the backend
 * decides. LINE-only features stay unavailable instead of being faked: no sharing, not
 * inside the LINE client, links open in a browser tab. */
export function localDevLiff(): Liff {
  return {
    init: () => Promise.resolve(),
    isLoggedIn: () => true,
    isInClient: () => false,
    login: () => {
      // never reached: isLoggedIn() is always true
    },
    logout: () => {
      // the server session is what logout ends; there is no LINE session here
    },
    getIDToken: () => DEV_LOGIN_TOKEN,
    isApiAvailable: () => false,
    shareTargetPicker: () => Promise.reject(new Error("shareTargetPicker is not available in local development")),
    openWindow: ({ url }) => {
      window.open(url, "_blank", "noopener");
    },
  };
}
