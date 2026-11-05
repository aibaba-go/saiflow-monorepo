/** Identity flows of the LINE mini app: boot (FR-SYS-040), LINE login (FR-SYS-041),
 * logout with lock (FR-SYS-043) and session expiry (FR-SYS-055-04). */

import { api, call, setUnauthenticatedHandler } from "../../services/api";
import { ApiError } from "../../services/errors";
import { initWithTimeout } from "../../services/liff";
import type { Liff } from "../../services/liffTypes";
import { useSession, type Me } from "../../stores/session";

export const LOGOUT_FLAG = "saiflow.logout-pending";
export const INTENT_KEY = "saiflow.auth-intent";
export const TENANT_KEY = "saiflow.tenant";
const INTENT_MAX_AGE_MS = 5 * 60_000;

export interface AuthDeps {
  liff: Liff;
  /** location.search at startup (entry=register, invite=...). */
  search: string;
  liffTimeoutMs: number;
  logoutTimeoutMs: number;
  navigate(to: string): void;
  currentPath(): string;
  /** Identity changed: drop cached server data. */
  onIdentityChange(): void;
}

let deps: AuthDeps;
let recovering = false;

export function configureAuth(d: AuthDeps): void {
  deps = d;
  setUnauthenticatedHandler(() => void handleUnauthenticated());
}

const store = () => useSession.getState();

function safe<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/** The current identity: GET /me, or a new guest session when there is none. */
export async function loadIdentity(): Promise<Me> {
  let me: Me;
  try {
    me = await call(api.GET("/api/v1/me"), { own401: true });
  } catch (error) {
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
    me = await call(api.POST("/api/v1/auth/guest"), { own401: true });
  }
  const tenants = me.kind === "user" ? await call(api.GET("/api/v1/me/tenants"), { own401: true }) : [];
  store().set({ me, tenants });
  return me;
}

function takeIntent(): { returnTo: string } | null {
  const raw = safe(() => sessionStorage.getItem(INTENT_KEY));
  safe(() => sessionStorage.removeItem(INTENT_KEY));
  if (!raw) return null;
  try {
    const intent = JSON.parse(raw) as { returnTo?: string; at?: number };
    if (typeof intent.at !== "number" || Date.now() - intent.at > INTENT_MAX_AGE_MS) return null;
    return { returnTo: typeof intent.returnTo === "string" ? intent.returnTo : "/" };
  } catch {
    return null;
  }
}

export async function boot(): Promise<void> {
  store().set({ status: "booting", error: null });
  try {
    if (safe(() => localStorage.getItem(LOGOUT_FLAG))) {
      try {
        await finishLogout();
      } catch {
        store().set({ status: "locked" });
        return;
      }
    }
    const me = await loadIdentity();
    await initWithTimeout(deps.liff, deps.liffTimeoutMs);
    const intent = takeIntent();
    store().set({ status: "ready" });
    if (intent && deps.liff.isLoggedIn()) {
      await completeLogin(intent.returnTo);
    } else if (new URLSearchParams(deps.search).get("entry") === "register" && me.kind !== "user") {
      await startLogin("/my");
    }
  } catch (error) {
    store().set({ status: "error", error });
  }
}

/** LINE login (FR-SYS-041): inside LINE the token is already there; outside, redirect. */
export async function startLogin(returnTo: string = deps.currentPath()): Promise<void> {
  store().set({ loginError: null });
  try {
    if (deps.liff.isLoggedIn()) {
      await completeLogin(returnTo);
      return;
    }
    safe(() => sessionStorage.setItem(INTENT_KEY, JSON.stringify({ returnTo, at: Date.now() })));
    deps.liff.login(window.location.href);
  } catch (error) {
    store().set({ loginError: error });
  }
}

async function completeLogin(returnTo: string): Promise<void> {
  try {
    const token = deps.liff.getIDToken();
    if (!token) throw new ApiError(0, "line_token_required", []);
    await call(api.POST("/api/v1/auth/line", { body: { id_token: token } }), { own401: true });
    deps.onIdentityChange();
    const me = await loadIdentity();
    if (me.kind === "user" && !me.registered) store().set({ registerOpen: true });
    deps.navigate(returnTo);
  } catch (error) {
    store().set({ loginError: error });
  }
}

async function finishLogout(): Promise<void> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), deps.logoutTimeoutMs);
  try {
    await call(api.POST("/api/v1/auth/logout", { signal: controller.signal }), { own401: true });
  } catch (error) {
    // already signed out on the server: nothing left to revoke
    if (!(error instanceof ApiError) || error.status !== 401) throw error;
  } finally {
    clearTimeout(timer);
  }
  safe(() => localStorage.removeItem(LOGOUT_FLAG));
  safe(() => localStorage.removeItem(TENANT_KEY));
  safe(() => sessionStorage.removeItem(INTENT_KEY));
  safe(() => deps.liff.logout());
  deps.onIdentityChange();
  await loadIdentity();
  store().set({ status: "ready", registerOpen: false, loginError: null });
  deps.navigate("/");
}

/** FR-SYS-043: mark first, then revoke; any failure locks the shell until retried. */
export async function logout(): Promise<void> {
  safe(() => localStorage.setItem(LOGOUT_FLAG, "1"));
  try {
    await finishLogout();
  } catch {
    store().set({ status: "locked" });
  }
}

export async function retryLogout(): Promise<void> {
  await logout();
}

/** FR-SYS-055-04: a 401 elsewhere means the session expired; carry on as a guest. */
export async function handleUnauthenticated(): Promise<void> {
  const { status } = store();
  if (recovering || status === "locked" || status === "booting") return;
  recovering = true;
  try {
    deps.onIdentityChange();
    await loadIdentity();
    store().set({ notice: "err.session_expired", registerOpen: false });
    deps.navigate("/");
  } catch (error) {
    store().set({ status: "error", error });
  } finally {
    recovering = false;
  }
}
