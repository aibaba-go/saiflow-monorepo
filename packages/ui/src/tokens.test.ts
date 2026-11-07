import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { adminTheme, pcTheme } from "./antdTheme";
import { COLORS, contrast, DENSITY, FONT_STACK, type ColorToken } from "./tokens";

const css = readFileSync(new URL("./styles/tokens.css", import.meta.url), "utf8");

describe("STD-008 tokens", () => {
  it("tokens.css matches tokens.ts", () => {
    for (const [name, value] of Object.entries(COLORS)) {
      expect(css).toMatch(new RegExp(`--${name}:\\s*${value};`, "i"));
    }
    expect(css).toMatch(/color-scheme:\s*light/);
  });

  it("reading text meets 4.5:1 (FR-SYS-137)", () => {
    const pairs: [ColorToken, ColorToken][] = [
      ["text", "surface"],
      ["text-secondary", "surface"],
      ["text-secondary", "bg"],
      ["on-primary", "primary"],
      ["on-primary", "danger"],
      ["primary", "surface"],
      ["success-text", "success-bg"],
      ["warning-text", "warning-bg"],
      ["review-text", "review-bg"],
      ["danger-text", "danger-bg"],
      ["info-text", "info-bg"],
      ["primary-pressed", "primary-soft"],
    ];
    for (const [fg, bg] of pairs) {
      expect(contrast(COLORS[fg], COLORS[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });

  it("contrast is WCAG", () => {
    expect(contrast("#FFFFFF", "#000000")).toBe(21);
    expect(contrast("#99A1B0", "#FFFFFF")).toBe(2.6);
  });

  it("antd themes follow STD-008", () => {
    expect(pcTheme.token).toMatchObject({
      colorPrimary: "#4A66F7",
      colorSuccess: "#1F9E6B",
      colorWarning: "#D98F1F",
      colorError: "#D6383E",
      borderRadius: 8,
      borderRadiusLG: 10,
      controlHeight: 36,
      fontSize: 14,
      fontFamily: FONT_STACK,
      colorBgLayout: "#F5F7FA",
      colorText: "#171A1C",
    });
    expect(pcTheme.components?.Table).toMatchObject({ cellPaddingBlock: 12 });
    expect(adminTheme.token).toMatchObject({
      colorPrimary: "#4A66F7",
      colorError: "#D6383E",
      borderRadius: 8,
      fontFamily: FONT_STACK,
    });
    expect(adminTheme.token).not.toHaveProperty("controlHeight");
    // antd colours Typography success/warning/danger text with these (final review I2)
    for (const theme of [pcTheme, adminTheme]) {
      const tk = theme.token as Record<string, unknown>;
      for (const key of ["colorSuccessText", "colorWarningText", "colorErrorText"]) {
        expect(contrast(String(tk[key] ?? "#FFFFFF"), COLORS.surface), key).toBeGreaterThanOrEqual(4.5);
      }
    }
    expect(DENSITY.mini.controlHeight).toBe(44);
    expect(DENSITY.pc.tableRow).toBe(44);
  });
});
