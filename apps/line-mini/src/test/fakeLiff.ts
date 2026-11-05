import { vi } from "vitest";

import type { Liff } from "../services/liffTypes";

export interface FakeLiffOptions {
  loggedIn?: boolean;
  inClient?: boolean;
  idToken?: string | null;
  /** init never settles (for the 20 s timeout) when "never". */
  init?: "ok" | "never" | Error;
  share?: boolean;
}

export type FakeLiff = Liff & {
  login: ReturnType<typeof vi.fn>;
  logout: ReturnType<typeof vi.fn>;
  shareTargetPicker: ReturnType<typeof vi.fn>;
};

export function fakeLiff(options: FakeLiffOptions = {}): FakeLiff {
  const state = { loggedIn: options.loggedIn ?? false };
  return {
    init: vi.fn(() => {
      if (options.init === "never") return new Promise<void>(() => {});
      if (options.init instanceof Error) return Promise.reject(options.init);
      return Promise.resolve();
    }),
    isLoggedIn: () => state.loggedIn,
    isInClient: () => options.inClient ?? true,
    login: vi.fn(() => {
      state.loggedIn = true;
    }),
    logout: vi.fn(() => {
      state.loggedIn = false;
    }),
    getIDToken: () => (state.loggedIn ? (options.idToken ?? "id-token") : null),
    isApiAvailable: (api: string) => api === "shareTargetPicker" && (options.share ?? true),
    shareTargetPicker: vi.fn(() => Promise.resolve({ status: "success" })),
  } as FakeLiff;
}
