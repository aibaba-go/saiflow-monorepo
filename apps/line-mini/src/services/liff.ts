import liff from "@line/liff";

import { devLoginEnabled } from "../config";
import { localDevLiff } from "./devLiff";
import { ApiError } from "./errors";
import type { Liff } from "./liffTypes";

export type { Liff } from "./liffTypes";

/** The real LIFF SDK behind the app's Liff interface. */
export function realLiff(liffId: string): Liff {
  return {
    init: () => liff.init({ liffId }),
    isLoggedIn: () => liff.isLoggedIn(),
    isInClient: () => liff.isInClient(),
    login: (redirectUri) => liff.login({ redirectUri }),
    logout: () => liff.logout(),
    getIDToken: () => liff.getIDToken(),
    isApiAvailable: (api) => liff.isApiAvailable(api),
    shareTargetPicker: (messages) => liff.shareTargetPicker(messages),
    openWindow: (params) => liff.openWindow(params),
  };
}

/** The LIFF the app runs with: the real SDK, or the restricted local dev adapter only on a
 * Vite dev server with VITE_DEV_LOGIN=1 on a loopback host and same-origin API
 * (NFR-DEV-002). The DEV guard lets production builds drop the adapter. */
export function appLiff(liffId: string): Liff {
  if (import.meta.env.DEV && devLoginEnabled()) return localDevLiff();
  return realLiff(liffId);
}

/** LIFF init, failing with liff_timeout after `ms` (FR-SYS-040: 20 s). */
export function initWithTimeout(target: Liff, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new ApiError(0, "liff_timeout", [])), ms);
    target.init().then(
      () => {
        clearTimeout(timer);
        resolve();
      },
      () => {
        clearTimeout(timer);
        reject(new ApiError(0, "liff_timeout", []));
      },
    );
  });
}
