/** LINE web login by authorization code (FR-SYS-090, A2): a random state kept for this
 * browser session only, valid 10 minutes, removed on first read. */
import { lineChannelId, redirectUri } from "../config";

export const LOGIN_STATE_KEY = "saiflow.pc.login";
const MAX_AGE_MS = 10 * 60_000;

/** Leaving the app for LINE; tests replace assign. */
export const external = {
  assign(url: string): void {
    window.location.assign(url);
  },
};

/** Where to go after login: only a page of this site, never /login itself. */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//")) return "/";
  // Browsers drop tabs and newlines and read a backslash as "/": "/\t/evil.com" would
  // become "//evil.com" (review M-1). No control character or backslash anywhere.
  if ([...next].some((c) => c.charCodeAt(0) < 0x20 || c.charCodeAt(0) === 0x7f || c === "\\")) return "/";
  if (next === "/login" || next.startsWith("/login?") || next.startsWith("/login#")) return "/";
  return next;
}

function randomState(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

export function authorizeUrl(state: string): string {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: lineChannelId,
    redirect_uri: redirectUri(),
    state,
    scope: "profile openid",
  });
  return `https://access.line.me/oauth2/v2.1/authorize?${params.toString()}`;
}

/** Remember where to return, then go to the LINE authorize page. */
export function startLineLogin(next: string, mode?: "link"): void {
  const state = randomState();
  try {
    sessionStorage.setItem(LOGIN_STATE_KEY, JSON.stringify({ state, next: safeNext(next), at: Date.now(), ...(mode ? { mode } : {}) }));
  } catch {
    // storage blocked: the callback will ask to log in again
  }
  external.assign(authorizeUrl(state));
}

/** Read and remove the saved login state; ok only when it matches and is fresh. */
export function takeLoginState(state: string | null): { ok: true; next: string; mode?: "link" } | { ok: false } {
  let raw: string | null;
  try {
    raw = sessionStorage.getItem(LOGIN_STATE_KEY);
    sessionStorage.removeItem(LOGIN_STATE_KEY);
  } catch {
    return { ok: false };
  }
  if (!raw || !state) return { ok: false };
  try {
    const saved = JSON.parse(raw) as { state?: unknown; next?: unknown; at?: unknown; mode?: unknown };
    if (saved.state !== state || typeof saved.at !== "number") return { ok: false };
    if (Date.now() - saved.at > MAX_AGE_MS || saved.at > Date.now()) return { ok: false };
    return { ok: true, next: safeNext(typeof saved.next === "string" ? saved.next : "/"), ...(saved.mode === "link" ? { mode: "link" as const } : {}) };
  } catch {
    return { ok: false };
  }
}
