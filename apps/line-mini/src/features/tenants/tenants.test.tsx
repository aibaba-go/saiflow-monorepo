import { screen } from "@testing-library/react";
import userEventLib from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { api, call } from "../../services/api";
import { useLanguage } from "../../stores/language";
import { useSession } from "../../stores/session";
import { ORG, PERSONAL, signedIn, USER } from "../../test/fixtures";
import { json, mockApi } from "../../test/mockApi";
import { renderWithProviders } from "../../test/render";
import { loadIdentity } from "../auth/session";
import { can } from "./permissions";
import { TenantSwitcher } from "./TenantSwitcher";
import { readStoredTenant, useTenantChoice } from "./useCurrentTenant";

const userEvent = userEventLib.setup({ pointerEventsCheck: 0 });

beforeEach(() => {
  localStorage.clear();
  useTenantChoice.getState().choose(null);
  useLanguage.getState().setLang("en");
});

describe("tenant switching (FR-SYS-046)", () => {
  it("switching sends X-Tenant-Id and persists (046-01)", async () => {
    const m = mockApi({ "GET /api/v1/billing/usage": () => json(200, {}) });
    signedIn(USER, [PERSONAL, ORG]);
    renderWithProviders(<TenantSwitcher />);
    await userEvent.click(screen.getByRole("button", { name: /Personal account/ }));
    await userEvent.click(await screen.findByRole("option", { name: "Siam Tools" }));
    expect(localStorage.getItem("saiflow.tenant")).toBe("5");
    await call(api.GET("/api/v1/billing/usage"));
    expect(m.calls.at(-1)!.headers.get("X-Tenant-Id")).toBe("5");
    useTenantChoice.getState().choose(null);
    await call(api.GET("/api/v1/billing/usage"));
    expect(m.calls.at(-1)!.headers.get("X-Tenant-Id")).toBeNull();
  });

  it("falls back to the personal tenant with a notice when the org is gone (046-02)", async () => {
    useTenantChoice.getState().choose(5);
    mockApi({
      "GET /api/v1/me": () => json(200, USER),
      "GET /api/v1/me/tenants": () => json(200, [PERSONAL]),
    });
    signedIn(USER, [PERSONAL, ORG]);
    await loadIdentity();
    expect(useTenantChoice.getState().id).toBeNull();
    expect(localStorage.getItem("saiflow.tenant")).toBeNull();
    expect(useSession.getState().notice).toBe("tenant.gone");
  });

  it.each(["abc", "0", "-3", "1.5", "99999999999999999999"])(
    "ignores a malformed stored value %s",
    (raw) => {
      localStorage.setItem("saiflow.tenant", raw);
      expect(readStoredTenant()).toBeNull();
    },
  );

  it("can(): the owner has everything; a member only the role's points (046-03)", () => {
    expect(can({ ...ORG, is_owner: true }, "member_manage")).toBe(true);
    expect(can(ORG, "member_manage")).toBe(false);
    expect(can(ORG, "export")).toBe(true);
    expect(can(null, "export")).toBe(false);
  });

  it("guests see no switcher", () => {
    useSession.setState({ me: { ...USER, kind: "guest" }, tenants: [], status: "ready" });
    renderWithProviders(<TenantSwitcher />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
