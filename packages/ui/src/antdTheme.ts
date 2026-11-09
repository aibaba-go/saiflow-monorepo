import { CLIENT_COLORS, DENSITY, FONT_STACK } from "./tokens";

/**
 * Ant Design themes from the STD-008 tokens (ADR-010 §2, §3). Plain objects, so this package
 * does not depend on antd; each app passes them to `ConfigProvider theme`.
 */
// Client brand (FR-SYS-132, enterprise-ui-redesign): primary #1A6FE8; states as STD-008.
export const pcTheme = {
  token: {
    colorPrimary: CLIENT_COLORS.primary,
    colorSuccess: CLIENT_COLORS.success,
    colorWarning: CLIENT_COLORS.warning,
    colorError: CLIENT_COLORS.danger,
    colorInfo: CLIENT_COLORS.info,
    // antd colours success/warning/danger text with these; the graphic colours are too light
    // for text on white (FR-SYS-137)
    colorSuccessText: CLIENT_COLORS["success-text"],
    colorWarningText: CLIENT_COLORS["warning-text"],
    colorErrorText: CLIENT_COLORS["danger-text"],
    colorBgLayout: CLIENT_COLORS.bg,
    colorBgContainer: CLIENT_COLORS.surface,
    colorBorder: CLIENT_COLORS.border,
    colorBorderSecondary: CLIENT_COLORS.border,
    colorText: CLIENT_COLORS.text,
    colorTextSecondary: CLIENT_COLORS["text-secondary"],
    colorTextPlaceholder: CLIENT_COLORS["text-tertiary"],
    borderRadius: DENSITY.pc.radiusControl,
    borderRadiusLG: DENSITY.pc.radiusCard,
    controlHeight: DENSITY.pc.controlHeight,
    fontSize: 14,
    lineHeight: 22 / 14,
    fontFamily: FONT_STACK,
  },
  components: {
    // 12px top and bottom plus a 20px line: the 44px table row of STD-008 §6.
    Table: { cellPaddingBlock: 12, headerBg: CLIENT_COLORS["surface-muted"] },
  },
};

/** admin uses the same brand theme and PC density as web-pc (FR-SYS-132/135; owner decision
 * 2026-11-09, enterprise-ui-redesign). A separate export so the apps stay decoupled. */
export const adminTheme = {
  token: { ...pcTheme.token },
  components: { ...pcTheme.components },
};
