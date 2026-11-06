import liff from "@line/liff";

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
