import { describe, expect, it } from "vitest";

import { translate } from "../i18n";
import { ApiError, errorMessage } from "./errors";

const t = (key: Parameters<typeof translate>[1]) => translate("en", key);

describe("errorMessage (AC-FR-SYS-055-03)", () => {
  it("uses the code's message", () => {
    expect(errorMessage(new ApiError(400, "email_code_invalid", []), t)).toBe(t("err.email_code_invalid"));
  });

  it("falls back for unknown codes and non-API errors", () => {
    expect(errorMessage(new ApiError(418, "teapot", []), t)).toBe(t("err.unknown"));
    expect(errorMessage(new Error("x"), t)).toBe(t("err.unknown"));
  });
});
