/** "" = same origin; Caddy (deployment) or the Vite proxy (development) routes /api. */
export const apiBaseUrl: string = import.meta.env.VITE_API_BASE_URL ?? "";

/** The LIFF app ID (public, set at build time from the GitHub variable LIFF_ID). */
export const liffId: string = import.meta.env.VITE_LIFF_ID ?? "";
