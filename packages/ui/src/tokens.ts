/**
 * SaiFlow design tokens — the single source of the values in STD-008
 * (docs/00-standards/UI-Design-System.md §2, §3, §5, §6). `styles/tokens.css` repeats the
 * colours as CSS variables; a test keeps the two equal.
 */
export const COLORS = {
  primary: "#4A66F7",
  "primary-hover": "#3D59EE",
  "primary-pressed": "#3149D4",
  "primary-soft": "#E8EDFF",
  "on-primary": "#FFFFFF",
  bg: "#F5F7FA",
  surface: "#FFFFFF",
  "surface-muted": "#F0F3F7",
  border: "#E3E8F0",
  "border-strong": "#CDD5E0",
  text: "#171A1C",
  "text-secondary": "#5D6673",
  "text-tertiary": "#99A1B0",
  icon: "#596170",
  track: "#EDF2F7",
  success: "#1F9E6B",
  "success-bg": "#E3F5ED",
  "success-text": "#18774F",
  warning: "#D98F1F",
  "warning-bg": "#FCF2E3",
  "warning-text": "#935D0E",
  review: "#E07B1A",
  "review-bg": "#FFF0E0",
  "review-text": "#A35400",
  danger: "#D6383E",
  "danger-bg": "#FDEAEA",
  "danger-text": "#C4343A",
  info: "#4A66F7",
  "info-bg": "#E8EDFF",
  "info-text": "#3149D4",
} as const;

export type ColorToken = keyof typeof COLORS;

/**
 * AIbaba / SaiFlow customer brand (enterprise-ui-redesign, FR-SYS-132): web-pc and the LINE
 * mini app use these instead of the COLORS of the same name; admin keeps COLORS.
 * `styles/brand.css` repeats them as CSS variables; a test keeps the two equal.
 */
export const BRAND_COLORS = {
  primary: "#1A6FE8",
  "primary-hover": "#1559C0",
  "primary-pressed": "#124A9E",
  "primary-soft": "#EAF2FF",
  info: "#1A6FE8",
  "info-bg": "#EAF2FF",
  "info-text": "#1559C0",
  border: "#E2E8F0",
  bg: "#F5F7FA",
  "brand-navy": "#0A2540",
  "brand-navy-2": "#11335A",
  "brand-blue": "#1A6FE8",
  "brand-blue-hover": "#1559C0",
  "brand-blue-soft": "#EAF2FF",
  "brand-teal": "#00C9A7",
  "brand-teal-ink": "#007D6C",
  "brand-border": "#E2E8F0",
  "brand-bg": "#F5F7FA",
  "brand-on-navy": "#FFFFFF",
  "brand-on-navy-muted": "#B9C6D8",
} as const;

export type BrandColorToken = keyof typeof BRAND_COLORS;

/** The customer palette: COLORS with the brand values in place (web-pc, line-mini). */
export const CLIENT_COLORS = { ...COLORS, ...BRAND_COLORS } as const;

export const FONT_STACK =
  '"IBM Plex Sans", "IBM Plex Sans Thai", "Noto Sans SC", -apple-system, "Segoe UI", sans-serif';

export const DENSITY = {
  mini: { radiusCard: 14, radiusControl: 10, controlHeight: 44 },
  pc: { radiusCard: 10, radiusControl: 8, controlHeight: 36, tableRow: 44 },
} as const;

function luminance(hex: string): number {
  const h = hex.replace("#", "");
  const full = h.length === 3 ? [...h].map((c) => c + c).join("") : h;
  const [r, g, b] = [0, 2, 4].map((i) => {
    const c = parseInt(full.slice(i, i + 2), 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG 2.x contrast ratio of two colours, rounded to two decimals. */
export function contrast(fg: string, bg: string): number {
  const [hi, lo] = [luminance(fg), luminance(bg)].sort((a, b) => b - a) as [number, number];
  return Math.round(((hi + 0.05) / (lo + 0.05)) * 100) / 100;
}
