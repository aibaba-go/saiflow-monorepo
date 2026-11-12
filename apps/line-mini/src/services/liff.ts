import liff from "@line/liff";

import { devLoginEnabled } from "../config";
import { localDevLiff } from "./devLiff";
import { ApiError } from "./errors";
import { logLiffInit, registerLiffDiagnostics } from "./liffDiagnostics";
import type { Liff } from "./liffTypes";

export type { Liff } from "./liffTypes";

/** The real LIFF SDK behind the app's Liff interface. */
export function realLiff(liffId: string): Liff {
  const target: Liff = {
    init: () => liff.init({ liffId }),
    isLoggedIn: () => liff.isLoggedIn(),
    isInClient: () => liff.isInClient(),
    getOS: () => liff.getOS(),
    login: (redirectUri) => liff.login({ redirectUri }),
    logout: () => liff.logout(),
    getIDToken: () => liff.getIDToken(),
    isApiAvailable: (api) => liff.isApiAvailable(api),
    shareTargetPicker: (messages) => liff.shareTargetPicker(messages),
    openWindow: (params) => liff.openWindow(params),
  };
  registerLiffDiagnostics(target, liffId, "real");
  return target;
}

/** The LIFF the app runs with: the real SDK, or the restricted local dev adapter only on a
 * Vite dev server with VITE_DEV_LOGIN=1 on a loopback host and same-origin API
 * (NFR-DEV-002). The DEV guard lets production builds drop the adapter. */
export function appLiff(liffId: string): Liff {
  if (import.meta.env.DEV && devLoginEnabled()) {
    const target = localDevLiff();
    registerLiffDiagnostics(target, liffId, "dev");
    return target;
  }
  return realLiff(liffId);
}

/** LIFF init, failing with liff_timeout after `ms` (FR-SYS-040: 20 s). */
export function initWithTimeout(target: Liff, ms: number): Promise<void> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      settled = true;
      logLiffInit(target, "timeout");
      reject(new ApiError(0, "liff_timeout", []));
    }, ms);
    let initialization: Promise<void>;
    try {
      initialization = target.init();
    } catch (error) {
      clearTimeout(timer);
      settled = true;
      logLiffInit(target, "failed");
      reject(error); // Preserve the synchronous SDK error, without logging its text.
      return;
    }
    initialization.then(
      () => {
        clearTimeout(timer);
        if (!settled) logLiffInit(target, "ready");
        settled = true;
        resolve();
      },
      () => {
        clearTimeout(timer);
        if (!settled) logLiffInit(target, "failed");
        settled = true;
        reject(new ApiError(0, "liff_timeout", []));
      },
    );
  });
}
