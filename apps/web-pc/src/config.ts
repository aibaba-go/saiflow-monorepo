/** "" = same origin; Caddy (deployment) or the Vite proxy (development) routes /api. */
export const apiBaseUrl: string = import.meta.env.VITE_API_BASE_URL ?? "";

/** The LIFF app ID of the LINE mini app (public, GitHub variable LIFF_ID): register and
 * invitation links open there (A3). */
export const liffId: string = import.meta.env.VITE_LIFF_ID ?? "";

/** The LINE Login channel ID (public, GitHub variable LINE_CHANNEL_ID), the client_id of the
 * LINE authorize URL (A1). */
export const lineChannelId: string = import.meta.env.VITE_LINE_CHANNEL_ID ?? "";

/** Where LINE returns after authorization; must be registered with LINE and in the backend's
 * LINE_LOGIN_REDIRECT_URIS (A1). */
export function redirectUri(): string {
  return `${window.location.origin}/login`;
}

/** What decides the restricted local dev login (NFR-DEV-002). */
export interface DevLoginEnv {
  /** import.meta.env.DEV: a Vite development server, never a production build. */
  dev: boolean;
  /** VITE_DEV_LOGIN: the explicit local switch, exactly "1". */
  flag: string | undefined;
  /** location.hostname of the page. */
  hostname: string;
  /** The API base: only "" (same-origin /api through the Vite proxy) qualifies. */
  apiBase: string;
}

const LOOPBACK_HOSTNAMES = new Set(["localhost", "127.0.0.1"]);

/** All four must hold; anything else is the normal LINE login (AC-NFR-DEV-001-01). */
export function devLoginAllowed(env: DevLoginEnv): boolean {
  return env.dev && env.flag === "1" && LOOPBACK_HOSTNAMES.has(env.hostname) && env.apiBase === "";
}

/** The local dev login switch for this page. Production builds replace
 * import.meta.env.DEV with false, so the dev branch is dropped from the bundle. */
export function devLoginEnabled(): boolean {
  if (!import.meta.env.DEV) return false;
  return devLoginAllowed({
    dev: import.meta.env.DEV,
    flag: import.meta.env.VITE_DEV_LOGIN as string | undefined,
    hostname: window.location.hostname,
    apiBase: apiBaseUrl,
  });
}
