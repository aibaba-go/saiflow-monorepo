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
  /** The login panel (FR-SYS-153) and the page it returns to after login. */
  loginOpen: boolean;
  lineLinkOpen: boolean;
  loginReturnTo: string | null;
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
  loginOpen: false,
  lineLinkOpen: false,
  loginReturnTo: null,
};

export const useSession = create<SessionState>((set) => ({
  ...initial,
  set: (partial) => set(partial),
  reset: () => set(initial),
}));

/** A tenant the app can act on: a usable tenant, or the guest's own temporary tenant. */
export type CurrentTenant = Omit<UsableTenant, "kind"> & { kind: UsableTenant["kind"] | "guest" };

export const isUser = (me: Me | null): boolean => me?.kind === "user";
