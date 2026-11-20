import { screen, waitFor } from "@testing-library/react";
import userEventLib from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { Shell } from "../../App";
import { devLoginAllowed, devLoginEnabled, type DevLoginEnv } from "../../config";
import { DEV_LOGIN_TOKEN, localDevLiff } from "../../services/devLiff";
import { useSession } from "../../stores/session";
import { json, mockApi } from "../../test/mockApi";
import { renderWithProviders } from "../../test/render";
import { LOGOUT_FLAG } from "./session";

// The real SDK is never started in these tests; appLiff's "real" branch is recognisable.
vi.mock("@line/liff", () => ({
  default: {
    init: () => Promise.resolve(),
    isLoggedIn: () => false,
    isInClient: () => true,
    login: () => {},
    logout: () => {},
    getIDToken: () => "real-line-token",
    isApiAvailable: () => true,
    shareTargetPicker: () => Promise.resolve(),
    openWindow: () => {},
  },
}));

const userEvent = userEventLib.setup({ pointerEventsCheck: 0 });

const DEV_USER = {
  kind: "user",
  user_id: 5,
  tenant_id: 6,
  display_name: "SaiFlow Dev",
  email: "dev@saiflow-local.example",
  email_suggestion: null,
  phone: null,
  avatar_url: null,
  registered: true,
};
const GUEST = { ...DEV_USER, kind: "guest", user_id: null, tenant_id: 90, display_name: null, email: null, registered: false };
const PERSONAL = { tenant_id: 6, kind: "personal", name: null, is_owner: true, role: null, permissions: [] };

const ON: DevLoginEnv = { dev: true, flag: "1", hostname: "localhost", apiBase: "" };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useSession.getState().reset();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

describe("local dev login switch (NFR-DEV-002, AC-NFR-DEV-001-01)", () => {
  it("is on only with dev mode, the flag, a loopback host and same-origin API", () => {
    expect(devLoginAllowed(ON)).toBe(true);
    expect(devLoginAllowed({ ...ON, hostname: "127.0.0.1" })).toBe(true);
  });

  it.each<[string, Partial<DevLoginEnv>]>([
    ["a production build", { dev: false }],
    ["no flag", { flag: undefined }],
    ["flag 0", { flag: "0" }],
    ["flag true (must be exactly 1)", { flag: "true" }],
    ["a LAN address", { hostname: "192.168.1.20" }],
    ["the deployed host", { hostname: "saiflow-liff.aibaba.asia" }],
    ["a cross-origin API", { apiBase: "https://saiflow-api.aibaba.asia" }],
    ["an absolute local API", { apiBase: "http://127.0.0.1:8010" }],
  ])("is off for %s", (_name, change) => {
    expect(devLoginAllowed({ ...ON, ...change })).toBe(false);
  });

  it("is off in this test build: no flag and an absolute API base", () => {
    expect(devLoginEnabled()).toBe(false);
  });

  it("the flag alone does not turn it on while the API is not same-origin", async () => {
    vi.stubEnv("VITE_DEV_LOGIN", "1"); // VITE_API_BASE_URL stays http://localhost (vite.config)
    vi.resetModules();
    const { appLiff } = await import("../../services/liff");
    expect(appLiff("liff-id").getIDToken()).toBe("real-line-token");
  });

  it("app LIFF is the real SDK when off", async () => {
    const { appLiff } = await import("../../services/liff");
    expect(appLiff("liff-id").getIDToken()).toBe("real-line-token");
  });

  it("app LIFF is the local adapter when every condition holds", async () => {
    vi.stubEnv("VITE_DEV_LOGIN", "1");
    vi.stubEnv("VITE_API_BASE_URL", "");
    vi.resetModules();
    const { appLiff } = await import("../../services/liff");
    const liff = appLiff("liff-id");
    expect(liff.getIDToken()).toBe(DEV_LOGIN_TOKEN);
    expect(liff.isLoggedIn()).toBe(true);
  });
});

describe("local dev LIFF adapter", () => {
  it("never fakes LINE-only features", async () => {
    const liff = localDevLiff();
    await expect(liff.init()).resolves.toBeUndefined();
    expect(liff.isInClient()).toBe(false);
    expect(liff.isApiAvailable("shareTargetPicker")).toBe(false);
    await expect(liff.shareTargetPicker([{ type: "text", text: "x" }])).rejects.toThrow();
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    liff.openWindow({ url: "http://localhost:5173/x", external: true });
    expect(open).toHaveBeenCalledWith("http://localhost:5173/x", "_blank", "noopener");
  });

  it("logs in with the reserved token, logs out, and logs in again (AC-NFR-DEV-002-01)", async () => {
    const api = mockApi({
      "GET /api/v1/me": () => json(200, GUEST),
      "GET /api/v1/me/tenants": () => json(200, [PERSONAL]),
      "POST /api/v1/auth/guest": () => json(200, GUEST),
      "GET /api/v1/billing/usage": () => json(404, { code: "not_found" }),
    });
    const signIn = () => {
      api.set("GET /api/v1/me", () => json(200, DEV_USER));
      return json(200, DEV_USER);
    };
    api.set("POST /api/v1/auth/line", signIn);
    api.set("POST /api/v1/auth/logout", () => {
      api.set("GET /api/v1/me", () => json(401, { code: "unauthenticated" }));
      api.set("POST /api/v1/auth/guest", () => {
        api.set("GET /api/v1/me", () => json(200, GUEST));
        return json(200, GUEST);
      });
      return json(204, null);
    });
    renderWithProviders(<Shell liff={localDevLiff()} search="" liffTimeoutMs={50} logoutTimeoutMs={50} />, {
      route: "/my",
    });

    // like inside LINE: starting the app does not log in by itself (AC-FR-SYS-040-03)
    await userEvent.click(await screen.findByRole("button", { name: "Log in / Register" }));
    await userEvent.click(await screen.findByRole("button", { name: "Log in with LINE" }));
    await waitFor(() => expect(useSession.getState().me?.kind).toBe("user"));
    expect(await screen.findByText("SaiFlow Dev")).toBeInTheDocument();
    expect(await api.bodies("POST /api/v1/auth/line")).toEqual([{ id_token: DEV_LOGIN_TOKEN }]);

    await userEvent.click(await screen.findByRole("button", { name: "Log out" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(useSession.getState().me?.kind).toBe("guest"));
    expect(localStorage.getItem(LOGOUT_FLAG)).toBeNull();

    api.set("POST /api/v1/auth/line", signIn);
    // logout ends on Home (FR-SYS-043); go back to My from the tab bar, so the click cannot
    // land on the My page that is about to unmount
    await screen.findByRole("button", { name: "Refresh" });
    await userEvent.click(await screen.findByRole("tab", { name: "My" }));
    await userEvent.click(await screen.findByRole("button", { name: "Log in / Register" }));
    await userEvent.click(await screen.findByRole("button", { name: "Log in with LINE" }));
    await waitFor(() => expect(useSession.getState().me?.display_name).toBe("SaiFlow Dev"));
    expect(api.count("POST /api/v1/auth/line")).toBe(2);
  }, 60_000);
});
