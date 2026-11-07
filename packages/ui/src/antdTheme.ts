import { COLORS, DENSITY, FONT_STACK } from "./tokens";

/**
 * Ant Design themes from the STD-008 tokens (ADR-010 §2, §3). Plain objects, so this package
 * does not depend on antd; each app passes them to `ConfigProvider theme`.
 */
export const pcTheme = {
  token: {
    colorPrimary: COLORS.primary,
    colorSuccess: COLORS.success,
    colorWarning: COLORS.warning,
    colorError: COLORS.danger,
    colorInfo: COLORS.info,
    // antd colours success/warning/danger text with these; the graphic colours are too light
    // for text on white (FR-SYS-137)
    colorSuccessText: COLORS["success-text"],
    colorWarningText: COLORS["warning-text"],
    colorErrorText: COLORS["danger-text"],
    colorBgLayout: COLORS.bg,
    colorBgContainer: COLORS.surface,
    colorBorder: COLORS.border,
    colorBorderSecondary: COLORS.border,
    colorText: COLORS.text,
    colorTextSecondary: COLORS["text-secondary"],
    colorTextPlaceholder: COLORS["text-tertiary"],
    borderRadius: DENSITY.pc.radiusControl,
    borderRadiusLG: DENSITY.pc.radiusCard,
    controlHeight: DENSITY.pc.controlHeight,
    fontSize: 14,
    lineHeight: 22 / 14,
    fontFamily: FONT_STACK,
  },
  components: {
    // 12px top and bottom plus a 20px line: the 44px table row of STD-008 §6.
    Table: { cellPaddingBlock: 12, headerBg: COLORS["surface-muted"] },
  },
};

/** admin keeps antd defaults except colours, radius and font (STD-008 §11.3). */
export const adminTheme = {
  token: {
    colorPrimary: COLORS.primary,
    colorSuccess: COLORS.success,
    colorWarning: COLORS.warning,
    colorError: COLORS.danger,
    colorSuccessText: COLORS["success-text"],
    colorWarningText: COLORS["warning-text"],
    colorErrorText: COLORS["danger-text"],
    borderRadius: DENSITY.pc.radiusControl,
    fontFamily: FONT_STACK,
  },
};
