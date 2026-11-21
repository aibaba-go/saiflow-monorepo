/** Identity flows of the LINE mini app: boot (FR-SYS-040), LINE login (FR-SYS-041), the
 * login panel with email login and password reset (FR-SYS-153, 154), logout with lock
 * (FR-SYS-043) and session expiry (FR-SYS-055-04). */

import { api, call, setUnauthenticatedHandler } from "../../services/api";
import { ApiError } from "../../services/errors";
import { initWithTimeout } from "../../services/liff";
import type { Liff } from "../../services/liffTypes";
import { useSession, type Me } from "../../stores/session";
import { reconcileTenantChoice, useTenantChoice } from "../tenants/useCurrentTenant";

export const LOGOUT_FLAG = "saiflow.logout-pending";
export const INTENT_KEY = "saiflow.auth-intent";
/** An invitation token from ?invite=, kept for this visit only (FR-SYS-052). */
export const INVITE_KEY = "saiflow.invite";
/** The invitation token the user tapped Join on (FR-SYS-052): the join resumes only for it. */
export const JOIN_KEY = "saiflow.invite-join";
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
/** A login or logout is changing the identity: its own requests may 401 meanwhile. */
let transitioning = false;

export function configureAuth(d: AuthDeps): void {
  deps = d;
  setUnauthenticatedHandler(() => void handleUnauthenticated());
}

const store = () => useSession.getState();

/** The LIFF SDK the app runs with (invite sharing uses it). */
export function authLiff(): Liff {
  return deps.liff;
}

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
  reconcileTenantChoice(me, tenants);
  return me;
}

/** Re-read the identity after a change (profile, email, a new organization). A user whose
 * session ended meanwhile is told so, instead of quietly becoming a guest. */
export async function reloadIdentity(): Promise<void> {
  const before = store().me;
  const me = await loadIdentity();
  if (before?.kind === "user" && me.kind !== "user") {
    store().set({ notice: "err.session_expired", registerOpen: false });
    deps.navigate("/");
  }
}

/** Re-read the user's tenants, e.g. an organization approved since the app opened
 * (AC-FR-SYS-047-04). A failure keeps the list already shown. */
export async function refreshTenants(): Promise<void> {
  const me = store().me;
  if (me?.kind !== "user") return;
  try {
    const tenants = await call(api.GET("/api/v1/me/tenants"));
    if (store().me !== me) return; // the identity changed meanwhile
    store().set({ tenants });
    reconcileTenantChoice(me, tenants);
  } catch {
    // keep the current list; a 401 is handled by the session-expiry handler
  }
}

function takeIntent(): { returnTo: string; mode?: "link" } | null {
  const raw = safe(() => sessionStorage.getItem(INTENT_KEY));
  safe(() => sessionStorage.removeItem(INTENT_KEY));
  if (!raw) return null;
  try {
    const intent = JSON.parse(raw) as { returnTo?: string; at?: number; mode?: string };
    if (typeof intent.at !== "number" || Date.now() - intent.at > INTENT_MAX_AGE_MS) return null;
    return { returnTo: typeof intent.returnTo === "string" ? intent.returnTo : "/", ...(intent.mode === "link" ? { mode: "link" as const } : {}) };
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
    const params = new URLSearchParams(deps.search);
    const invite = params.get("invite");
    if (invite && invite.length <= 128) {
      safe(() => sessionStorage.setItem(INVITE_KEY, invite));
      safe(() => sessionStorage.removeItem(JOIN_KEY));
      deps.navigate("/invite");
    }
    if (intent?.mode === "link") {
      store().set({ loginOpen: true, lineLinkOpen: true, registerOpen: false, loginReturnTo: intent.returnTo });
      deps.navigate(intent.returnTo);
    } else if (intent && deps.liff.isLoggedIn()) {
      await completeLogin(intent.returnTo);
    } else if (params.get("entry") === "register" && !(me.kind === "user" && me.registered)) {
      await startLogin("/my");
    }
  } catch (error) {
    store().set({ status: "error", error });
  }
}

/** A failed verification is not an unregistered identity (FR-SYS-001-03). On explicit
 * retry only, discard the rejected SDK authorization instead of sending the same token. */
function needsFreshLineToken(error: unknown): boolean {
  return error instanceof ApiError && (error.code === "line_token_invalid" || error.code === "line_token_required");
}

function rememberLogin(returnTo: string): void {
  safe(() => sessionStorage.setItem(INTENT_KEY, JSON.stringify({ returnTo, at: Date.now() })));
}

function reopenLine(returnTo: string): void {
  rememberLogin(returnTo);
  // Native LIFF cannot call login directly: boot runs init and consumes the intent once.
  if (safe(() => deps.liff.isInClient())) window.location.reload();
  else deps.liff.login(window.location.href);
}

/** LINE login (FR-SYS-041): inside LINE the token is already there; outside, redirect. */
export async function startLogin(returnTo: string = deps.currentPath()): Promise<void> {
  const { me, loginError } = store();
  if (me?.kind === "user" && !me.registered) {
    openLogin(returnTo); // FR-SYS-042: this server-authenticated user needs registration only
    deps.navigate(returnTo);
    return;
  }
  store().set({ loginError: null });
  try {
    if (needsFreshLineToken(loginError)) {
      if (deps.liff.reauthorize) {
        rememberLogin(returnTo);
        deps.liff.reauthorize(window.location.href);
      } else {
        // Local/test adapters without real LINE authorization keep their existing flow.
        if (!safe(() => deps.liff.isInClient())) deps.liff.logout();
        reopenLine(returnTo);
      }
      return;
    }
    if (deps.liff.isLoggedIn()) {
      await completeLogin(returnTo);
      return;
    }
    reopenLine(returnTo);
  } catch (error) {
    store().set({ loginError: error, loginOpen: true, loginReturnTo: returnTo });
  }
}

async function completeLogin(returnTo: string): Promise<void> {
  transitioning = true;
  try {
    const token = deps.liff.getIDToken();
    if (!token) throw new ApiError(0, "line_token_required", []);
    await call(api.POST("/api/v1/auth/line", { body: { id_token: token } }), { own401: true });
    deps.onIdentityChange();
    const me = await loadIdentity();
    store().set({
      loginOpen: false, loginReturnTo: null, loginError: null,
      registerOpen: me.kind === "user" && !me.registered,
    });
    deps.navigate(returnTo);
  } catch (error) {
    // AC-FR-SYS-041-03: stay on the page as a guest; the panel shows the error and LINE again.
    store().set({ loginError: error, loginOpen: true, loginReturnTo: returnTo });
  } finally {
    transitioning = false;
  }
}

/** Keys a login-requiring action leaves behind so it resumes after login (the result page's
 * confirm, an invitation's join). Closing the panel drops them (AC-FR-SYS-153-05). */
const RESUME_PREFIXES = ["saiflow.confirm-after-login.", JOIN_KEY];

function dropResumeFlags(): void {
  safe(() => {
    for (let i = sessionStorage.length - 1; i >= 0; i -= 1) {
      const key = sessionStorage.key(i);
      if (key && RESUME_PREFIXES.some((p) => key.startsWith(p))) sessionStorage.removeItem(key);
    }
  });
}

/** Open login (FR-SYS-153), or registration for a server-authenticated unregistered user
 * (FR-SYS-042). LIFF's logged-in flag alone never decides which identity to show. */
export function openLogin(returnTo: string = deps.currentPath()): void {
  const me = store().me;
  if (me?.kind === "user" && !me.registered) {
    store().set({ registerOpen: true, loginOpen: false, loginReturnTo: null, loginError: null });
  } else store().set({ loginOpen: true, loginReturnTo: returnTo, loginError: null });
}

/** The user closed the panel: keep the identity and the page, cancel the pending action. */
export function closeLogin(): void {
  dropResumeFlags();
  store().set({ loginOpen: false, lineLinkOpen: false, loginReturnTo: null, loginError: null });
}

/** "LINE 登录" in the panel (FR-SYS-041): the panel closes while LINE takes over. */
export function startLineLink(fresh = false): void {
  const returnTo = store().loginReturnTo ?? deps.currentPath();
  store().set({ lineLinkOpen: true, loginOpen: true, registerOpen: false, loginReturnTo: returnTo });
  if (!fresh && deps.liff.isLoggedIn() && deps.liff.getIDToken()) return;
  safe(() => sessionStorage.setItem(INTENT_KEY, JSON.stringify({ returnTo, mode: "link", at: Date.now() })));
  if (fresh && deps.liff.reauthorize) deps.liff.reauthorize(window.location.href);
  else if (safe(() => deps.liff.isInClient())) window.location.reload();
  else deps.liff.login(window.location.href);
}

export function linkLineAccount(email: string, proof: { password: string } | { email_code: string }): Promise<void> {
  const id_token = deps.liff.getIDToken();
  if (!id_token) return Promise.reject(new ApiError(400, "line_token_required", []));
  return switchIdentity(() => call(api.POST("/api/v1/auth/line-link", { body: { email, id_token, ...proof } }), { own401: true }));
}

export async function loginWithLineFromPanel(): Promise<void> {
  const returnTo = store().loginReturnTo ?? deps.currentPath();
  store().set({ loginOpen: false, loginReturnTo: null });
  await startLogin(returnTo);
}

/** An email login or reset that already holds a session cookie: switch to it and go back. */
async function switchIdentity(request: () => Promise<unknown>): Promise<void> {
  const returnTo = store().loginReturnTo ?? deps.currentPath();
  transitioning = true;
  try {
    await request();
    deps.onIdentityChange();
    const me = await loadIdentity();
    store().set({ loginOpen: false, lineLinkOpen: false, loginReturnTo: null, loginError: null });
    if (me.kind === "user" && !me.registered) store().set({ registerOpen: true });
    deps.navigate(returnTo);
  } finally {
    transitioning = false;
  }
}

/** FR-SYS-149: email and password. Errors are thrown to the panel's form. */
export function loginWithPassword(email: string, password: string): Promise<void> {
  return switchIdentity(() =>
    call(api.POST("/api/v1/auth/password", { body: { email, password } }), { own401: true }),
  );
}

/** FR-SYS-150: email and a "login" code. */
export function loginWithEmailCode(email: string, code: string): Promise<void> {
  return switchIdentity(() =>
    call(api.POST("/api/v1/auth/email-login", { body: { email, code } }), { own401: true }),
  );
}

/** FR-SYS-151, 154: reset with a "reset" code; the user is then logged in. */
export async function resetPassword(email: string, code: string, password: string): Promise<void> {
  await switchIdentity(() =>
    call(api.POST("/api/v1/auth/password-reset", { body: { email, code, password } }), { own401: true }),
  );
  store().set({ notice: "login.resetDone" });
}

/** A login or reset code to an email (FR-SYS-150, 151). */
export async function sendAuthEmailCode(email: string, purpose: "login" | "reset"): Promise<void> {
  await call(api.POST("/api/v1/auth/email-code", { body: { email, purpose } }), { own401: true });
}

async function finishLogout(): Promise<void> {
  transitioning = true;
  try {
    await revokeAndBecomeGuest();
  } finally {
    transitioning = false;
  }
}

async function revokeAndBecomeGuest(): Promise<void> {
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
  deps.onIdentityChange(); // drop the old identity's data before anything re-renders
  useTenantChoice.getState().choose(null);
  safe(() => sessionStorage.removeItem(INTENT_KEY));
  // Inside LINE the LINE account stays signed in (the LIFF browser has no login() to come
  // back with); only the SaiFlow session ends. Outside LINE the LIFF token is dropped too.
  if (!safe(() => deps.liff.isInClient())) safe(() => deps.liff.logout());
  await loadIdentity();
  store().set({ status: "ready", registerOpen: false, loginOpen: false, loginError: null, notice: "my.loggedOut" });
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
  if (recovering || transitioning || status === "locked" || status === "booting") return;
  recovering = true;
  try {
    const before = store().me;
    deps.onIdentityChange();
    const me = await loadIdentity();
    // A guest still on the same trial was asked to log in; a guest whose trial ended got a
    // new one; a user's session ended (minor-fixes-ui).
    const notice =
      before?.kind === "guest"
        ? me.tenant_id === before.tenant_id
          ? "err.unauthenticated"
          : "err.guest_expired"
        : "err.session_expired";
    store().set({ notice, registerOpen: false });
    deps.navigate("/");
  } catch (error) {
    store().set({ status: "error", error });
  } finally {
    recovering = false;
  }
}
