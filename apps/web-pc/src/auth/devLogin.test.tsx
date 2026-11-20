import { screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { devLoginAllowed, type DevLoginEnv } from "../config";
import { useLanguage } from "../stores/language";
import { useTenantChoice } from "../tenants/useCurrentTenant";
import { en, renderAt, userEvent } from "../test/app";
import { USER } from "../test/fixtures";
import { json, mockApi } from "../test/mockApi";
import { DEV_LOGIN_TOKEN } from "./devLogin";
import { external } from "./lineLogin";

// The page-level switch; its real logic is tested through devLoginAllowed and importActual.
// (A same-origin "" API base cannot be rendered here: Node's Request needs absolute URLs.)
const devSwitch = vi.hoisted(() => ({ on: false }));
vi.mock("../config", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config")>()),
  devLoginEnabled: () => devSwitch.on,
}));

const ORIGIN = window.location.origin;
const ON: DevLoginEnv = { dev: true, flag: "1", hostname: "localhost", apiBase: "" };

beforeEach(() => {
  devSwitch.on = false;
  localStorage.clear();
  sessionStorage.clear();
  useLanguage.getState().setLang("en");
  useTenantChoice.getState().reset();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
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
    ["the deployed host", { hostname: "saiflow-app.aibaba.asia" }],
    ["a cross-origin API", { apiBase: "https://saiflow-api.aibaba.asia" }],
    ["an absolute local API", { apiBase: "http://127.0.0.1:8010" }],
  ])("is off for %s", (_name, change) => {
    expect(devLoginAllowed({ ...ON, ...change })).toBe(false);
  });

  it("the real switch is off in this test build, even with the flag (absolute API base)", async () => {
    const actual = await vi.importActual<typeof import("../config")>("../config");
    expect(actual.devLoginEnabled()).toBe(false);
    vi.stubEnv("VITE_DEV_LOGIN", "1");
    expect(actual.devLoginEnabled()).toBe(false);
  });
});

describe("login page", () => {
  const backend = () => {
    let me: unknown = null;
    return mockApi({
      "GET /api/v1/me": () => (me ? json(200, me) : json(401, { code: "unauthenticated" })),
      "GET /api/v1/me/tenants": () => json(200, []),
      "GET /api/v1/me/notifications": () => json(200, { items: [], unread_count: 0, next_before: null }),
      "POST /api/v1/auth/line": () => {
        me = USER;
        return json(200, USER);
      },
      "POST /api/v1/auth/logout": () => {
        me = null;
        return json(204, null);
      },
    });
  };

  it("switched off: only the LINE button, which still goes to LINE", async () => {
    const api = backend();
    renderAt("/login");
    const assign = vi.spyOn(external, "assign").mockImplementation(() => {});
    await userEvent.click(await screen.findByRole("button", { name: en("login.button") }));
    expect(assign).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: en("auth.devLogin") })).not.toBeInTheDocument();
    expect(api.count("POST /api/v1/auth/line")).toBe(0);
  });

  it("switched on: the dev button signs in through the LINE endpoint, then logout and again (AC-NFR-DEV-002-01)", async () => {
    devSwitch.on = true;
    const api = backend();
    const assign = vi.spyOn(external, "assign").mockImplementation(() => {});
    renderAt("/plans");
    expect(await screen.findByRole("button", { name: en("login.button") })).toBeInTheDocument();
    expect(screen.getByText(en("auth.devLoginHint"))).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: en("auth.devLogin") }));
    expect(await screen.findByText("Somchai")).toBeInTheDocument();
    expect(await screen.findByTestId("page-plans")).toBeInTheDocument();
    expect(await api.bodies("POST /api/v1/auth/line")).toEqual([
      { code: DEV_LOGIN_TOKEN, redirect_uri: `${ORIGIN}/login` },
    ]);
    expect(assign).not.toHaveBeenCalled(); // no LINE redirect

    await userEvent.click(await screen.findByRole("button", { name: en("my.logout") }));
    await userEvent.click(await screen.findByRole("button", { name: en("common.confirm") }));
    expect(api.count("POST /api/v1/auth/logout")).toBe(1);
    await userEvent.click(await screen.findByRole("button", { name: en("auth.devLogin") }));
    expect(await screen.findByText("Somchai")).toBeInTheDocument();
    expect(api.count("POST /api/v1/auth/line")).toBe(2);
  }, 60_000);

  it("switched on: a refused dev login shows the error and keeps both buttons", async () => {
    devSwitch.on = true;
    mockApi({
      "GET /api/v1/me": () => json(401, { code: "unauthenticated" }),
      "POST /api/v1/auth/line": () => json(401, { code: "line_token_invalid" }),
    });
    renderAt("/login");
    await userEvent.click(await screen.findByRole("button", { name: en("auth.devLogin") }));
    expect(await screen.findByText(en("err.line_token_invalid"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en("auth.devLogin") })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en("common.retry") })).toBeInTheDocument();
  });
});
