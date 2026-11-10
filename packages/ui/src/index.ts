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

// Shared template component (template-report-management). The antd TemplateEditor itself is
// exported from "@saiflow/ui/template-editor" so that the LINE mini app (no antd) can import
// this entry point.
export * from "./components/TemplateEditor/core";
