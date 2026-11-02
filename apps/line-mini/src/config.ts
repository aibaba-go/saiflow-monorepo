/** "" = same origin; Caddy (deployment) or the Vite proxy (development) routes /api. */
export const apiBaseUrl: string = import.meta.env.VITE_API_BASE_URL ?? "";
