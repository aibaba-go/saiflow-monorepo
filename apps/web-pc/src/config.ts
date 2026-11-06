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
