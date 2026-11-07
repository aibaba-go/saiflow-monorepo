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
