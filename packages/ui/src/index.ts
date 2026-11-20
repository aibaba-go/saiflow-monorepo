// SaiFlow design tokens and themes (STD-008, ADR-010).
export {
  BRAND_COLORS,
  CLIENT_COLORS,
  COLORS,
  contrast,
  DENSITY,
  FONT_STACK,
  type BrandColorToken,
  type ColorToken,
} from "./tokens";
export { adminTheme, pcTheme } from "./antdTheme";
export { loadChineseFont } from "./fonts";

// Shared report and template components (template-report-management, F02–F04).
// The antd TemplateEditor itself is exported from "@saiflow/ui/template-editor" so that the
// LINE mini app (no antd) can import this entry point.
export * from "./components/ChartRenderer";
export * from "./components/ReportCardInfo";
export * from "./components/ReportGrid";
export * from "./components/TemplateEditor/core";
export * from "./components/reportTypes";
export {
  clampPrecision,
  formatDecimal,
  isDecimalString,
  isNegativeDecimal,
  MAX_PRECISION,
  MIN_PRECISION,
  parseDecimal,
  type DecimalFormatOptions,
  type ParsedDecimal,
} from "./components/decimal";
