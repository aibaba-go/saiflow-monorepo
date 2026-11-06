import { describe, expect, it } from "vitest";

import { translate } from "../i18n";
import { ApiError, errorMessage } from "./errors";

describe("error text (AC-FR-SYS-104-04)", () => {
  it("an unknown code shows the generic message of the current language", () => {
    const t = (key: Parameters<typeof translate>[1]) => translate("zh", key);
    expect(errorMessage(new ApiError(400, "something_new", []), t)).toBe(translate("zh", "err.unknown"));
    expect(errorMessage(new ApiError(400, "something_new", []), t)).not.toMatch(/something_new/);
  });

  it("a known code shows its own text; network has its own", () => {
    const t = (key: Parameters<typeof translate>[1]) => translate("th", key);
    expect(errorMessage(new ApiError(409, "member_limit_reached", []), t)).toBe(
      translate("th", "err.member_limit_reached"),
    );
    expect(errorMessage(new ApiError(0, "network", []), t)).toBe(translate("th", "err.network"));
  });
});
