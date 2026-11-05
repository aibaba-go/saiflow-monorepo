import type { components } from "@saiflow/api-client";
import { create } from "zustand";

import type { MessageKey } from "../i18n";

export type Me = components["schemas"]["MeResponse"];
export type UsableTenant = components["schemas"]["UsableTenantOut"];

/** Who is using the app (FR-SYS-040): booting → ready, or error (retry) / locked (logout). */
export interface SessionState {
  me: Me | null;
  tenants: UsableTenant[];
  status: "booting" | "ready" | "error" | "locked";
  /** The boot error (shown with Retry), as an ApiError. */
  error: unknown;
  /** The last LINE login error, shown on the My page. */
  loginError: unknown;
  /** A one-off message to show as a toast, then cleared. */
  notice: MessageKey | null;
  registerOpen: boolean;
  set(partial: Partial<SessionState>): void;
  reset(): void;
}

const initial = {
  me: null,
  tenants: [],
  status: "booting" as const,
  error: null,
  loginError: null,
  notice: null,
  registerOpen: false,
};

export const useSession = create<SessionState>((set) => ({
  ...initial,
  set: (partial) => set(partial),
  reset: () => set(initial),
}));

export const isUser = (me: Me | null): boolean => me?.kind === "user";
