import { act, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { api, call } from "../services/api";
import { useLanguage } from "../stores/language";
import { useTenantChoice } from "../tenants/useCurrentTenant";
import { dashboard, en, renderAt, signedIn, userEvent } from "../test/app";
import { ORG, OTHER, PERSONAL, UNREGISTERED, USER } from "../test/fixtures";
import { json, mockApi } from "../test/mockApi";
import { external, LOGIN_STATE_KEY } from "./lineLogin";

const ORIGIN = window.location.origin;

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useLanguage.getState().setLang("en");
  useTenantChoice.getState().reset(); // a fresh page load
});
afterEach(() => vi.restoreAllMocks());

const noSession = (routes = {}) =>
  mockApi({ "GET /api/v1/me": () => json(401, { code: "unauthenticated" }), ...routes });

/** Click "Log in with LINE" and return the authorize URL it went to. */
async function startLogin(): Promise<URL> {
  const assign = vi.spyOn(external, "assign").mockImplementation(() => {});
  await userEvent.click(await screen.findByRole("button", { name: en("login.button") }));
  expect(assign).toHaveBeenCalledTimes(1);
  return new URL(assign.mock.calls[0]![0]);
}

function saveState(state: string, next: string, at = Date.now()) {
  sessionStorage.setItem(LOGIN_STATE_KEY, JSON.stringify({ state, next, at }));
}

describe("LINE web login (FR-SYS-090)", () => {
  it("without a session /plans shows the login page; the button goes to LINE (090-01, part 1)", async () => {
    noSession();
    renderAt("/plans");
    const url = await startLogin();
    expect(url.origin + url.pathname).toBe("https://access.line.me/oauth2/v2.1/authorize");
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("client_id")).toBe("1234567890");
    expect(url.searchParams.get("redirect_uri")).toBe(`${ORIGIN}/login`);
    expect(url.searchParams.get("scope")).toBe("profile openid");
    expect(url.searchParams.get("state")).toMatch(/^[0-9a-f]{32}$/);
    const saved = JSON.parse(sessionStorage.getItem(LOGIN_STATE_KEY)!);
    expect(saved).toMatchObject({ state: url.searchParams.get("state"), next: "/plans" });
  });

  it("the callback with the saved state posts the code once and lands on /plans (090-01, part 2)", async () => {
    saveState("a".repeat(32), "/plans");
    let me: unknown = null;
    const api = mockApi({
      "GET /api/v1/me": () => (me ? json(200, me) : json(401, { code: "unauthenticated" })),
      "GET /api/v1/me/tenants": () => json(200, []),
      "GET /api/v1/me/notifications": () => json(200, { items: [], unread_count: 0, next_before: null }),
      "POST /api/v1/auth/line": () => {
        me = USER;
        return json(200, USER);
      },
    });
    renderAt(`/login?code=abc&state=${"a".repeat(32)}`);
    expect(await screen.findByText("Somchai")).toBeInTheDocument();
    expect(await screen.findByTestId("page-plans")).toBeInTheDocument();
    expect(await api.bodies("POST /api/v1/auth/line")).toEqual([{ code: "abc", redirect_uri: `${ORIGIN}/login` }]);
    expect(sessionStorage.getItem(LOGIN_STATE_KEY)).toBeNull();
  });

  it("cancel at LINE and a failed login stay on the login page with Retry (090-02)", async () => {
    saveState("b".repeat(32), "/");
    noSession();
    const first = renderAt(`/login?error=access_denied&state=${"b".repeat(32)}`);
    expect(await screen.findByText(en("err.line_cancelled"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en("common.retry") })).toBeInTheDocument();
    first.unmount();

    saveState("c".repeat(32), "/");
    noSession({ "POST /api/v1/auth/line": () => json(400, { code: "line_token_invalid" }) });
    renderAt(`/login?code=x&state=${"c".repeat(32)}`);
    expect(await screen.findByText(en("err.line_token_invalid"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en("common.retry") })).toBeInTheDocument();
  });

  it.each([
    ["differs", () => saveState("d".repeat(32), "/")],
    ["is missing", () => {}],
    ["is older than 10 minutes", () => saveState("e".repeat(32), "/", Date.now() - 10 * 60_000 - 1)],
  ])("a callback whose state %s posts nothing and asks to log in again (090-03)", async (_name, setup) => {
    setup();
    const api = noSession({ "POST /api/v1/auth/line": () => json(200, USER) });
    renderAt(`/login?code=x&state=${"e".repeat(32)}`);
    expect(await screen.findByText(en("login.again"))).toBeInTheDocument();
    expect(api.count("POST /api/v1/auth/line")).toBe(0);
  });

  it("opening the same callback twice posts once (Review Focus 1)", async () => {
    saveState("f".repeat(32), "/");
    const api = noSession({ "POST /api/v1/auth/line": () => json(400, { code: "line_token_invalid" }) });
    const first = renderAt(`/login?code=x&state=${"f".repeat(32)}`);
    await screen.findByText(en("err.line_token_invalid"));
    first.unmount();
    renderAt(`/login?code=x&state=${"f".repeat(32)}`);
    expect(await screen.findByText(en("login.again"))).toBeInTheDocument();
    expect(api.count("POST /api/v1/auth/line")).toBe(1);
  });

  it.each(["//evil.com", "https://evil.com", "/login", "/\t/evil.com", "/\\evil.com"])(
    "next %s lands on the home page (Review Focus 2)",
    async (next) => {
      saveState("9".repeat(32), next);
      let me: unknown = null;
      mockApi({
        "GET /api/v1/me": () => (me ? json(200, me) : json(401, { code: "unauthenticated" })),
        "GET /api/v1/me/homepage": () => json(200, { report_id: null, default: "personal" }),
        "GET /api/v1/me/dashboard": () => json(200, dashboard("personal")),
        "GET /api/v1/me/tenants": () => json(200, []),
        "GET /api/v1/me/notifications": () => json(200, { items: [], unread_count: 0, next_before: null }),
        "POST /api/v1/auth/line": () => {
          me = USER;
          return json(200, USER);
        },
      });
      renderAt(`/login?code=x&state=${"9".repeat(32)}`);
      expect(await screen.findByTestId("page-home")).toBeInTheDocument();
    },
  );

  it("a 401 mid-use clears the page and returns there after login (090-04)", async () => {
    const backend = signedIn({ "GET /api/v1/billing/usage": () => json(401, { code: "unauthenticated" }) });
    renderAt("/plans");
    await screen.findByText("Somchai");
    backend.set("GET /api/v1/me", () => json(401, { code: "unauthenticated" }));
    // Any page request that meets the expired session (here the usage card's).
    await act(() => call(api.GET("/api/v1/billing/usage")).catch(() => undefined));
    expect(await screen.findByText(en("err.session_expired"))).toBeInTheDocument();
    expect(screen.queryByText("Somchai")).not.toBeInTheDocument();
    const url = await startLogin();
    expect(JSON.parse(sessionStorage.getItem(LOGIN_STATE_KEY)!).next).toBe("/plans");
    expect(url.searchParams.get("state")).toMatch(/^[0-9a-f]{32}$/);
  });
});

describe("explicit LINE linking", () => {
  it("waits for customer proof and calls only the linking endpoint", async () => {
    sessionStorage.setItem(LOGIN_STATE_KEY, JSON.stringify({ state: "a".repeat(32), next: "/plans", at: Date.now(), mode: "link" }));
    let me: unknown = null;
    const backend = mockApi({
      "GET /api/v1/me": () => me ? json(200, me) : json(401, { code: "unauthenticated" }),
      "GET /api/v1/me/tenants": () => json(200, []),
      "GET /api/v1/me/notifications": () => json(200, { items: [], unread_count: 0, next_before: null }),
      "POST /api/v1/auth/line-link": () => { me = USER; return json(200, USER); },
    });
    renderAt(`/login?code=real-code&state=${"a".repeat(32)}`);
    await screen.findByRole("button", { name: en("line.linkSubmit") });
    expect(backend.count("POST /api/v1/auth/line")).toBe(0);
    expect(backend.count("POST /api/v1/auth/line-link")).toBe(0);
    await userEvent.type(screen.getByLabelText(en("login.email")), "somchai@example.com");
    await userEvent.type(screen.getByLabelText(en("login.password")), "SafePass123");
    await userEvent.click(screen.getByRole("button", { name: en("line.linkSubmit") }));
    expect(await screen.findByTestId("page-plans")).toBeInTheDocument();
    expect(await backend.bodies("POST /api/v1/auth/line-link")).toEqual([{ email: "somchai@example.com", password: "SafePass123", code: "real-code", redirect_uri: `${ORIGIN}/login` }]);
    expect(backend.count("POST /api/v1/auth/line")).toBe(0);
    expect(sessionStorage.getItem(LOGIN_STATE_KEY)).toBeNull();
  });

  it("shows code proof failures at the code field", async () => {
    sessionStorage.setItem(LOGIN_STATE_KEY, JSON.stringify({ state: "a".repeat(32), next: "/", at: Date.now(), mode: "link" }));
    noSession({ "POST /api/v1/auth/line-link": () => json(400, { code: "email_code_invalid", fields: ["email_code"] }) });
    renderAt(`/login?code=real-code&state=${"a".repeat(32)}`);
    await screen.findByRole("button", { name: en("line.linkSubmit") });
    await userEvent.click(screen.getByText(en("login.byCode")));
    await userEvent.type(screen.getByLabelText(en("login.email")), "somchai@example.com");
    await userEvent.type(screen.getByLabelText(en("login.code")), "123456");
    await userEvent.click(screen.getByRole("button", { name: en("line.linkSubmit") }));
    expect(await screen.findByText(en("err.email_code_invalid"))).toBeInTheDocument();
    expect(screen.getByLabelText(en("login.email"))).toHaveValue("somchai@example.com");
  });
});

describe("unregistered users (FR-SYS-091)", () => {
  it("see only the guide with the register link and a QR code (091-01)", async () => {
    signedIn({}, { me: UNREGISTERED });
    renderAt("/");
    expect(await screen.findByText(en("guide.title"))).toBeInTheDocument();
    const link = screen.getByRole("link", { name: en("guide.link") });
    expect(link).toHaveAttribute("href", "https://liff.line.me/test-liff?entry=register");
    expect(screen.getByTestId("register-qr")).toBeInTheDocument();
    expect(screen.queryByRole("menu")).not.toBeInTheDocument();
  });

  it("I have registered: enters the home page once registered (091-02)", async () => {
    const api = signedIn({}, { me: UNREGISTERED });
    renderAt("/");
    await screen.findByText(en("guide.title"));
    api.set("GET /api/v1/me", () => json(200, USER));
    await userEvent.click(screen.getByRole("button", { name: en("guide.done") }));
    expect(await screen.findByTestId("page-home")).toBeInTheDocument();
    expect(screen.getByText("Somchai")).toBeInTheDocument();
  });

  it("still unregistered stays on the guide with a hint (091-03)", async () => {
    signedIn({}, { me: UNREGISTERED });
    renderAt("/");
    await screen.findByText(en("guide.title"));
    await userEvent.click(screen.getByRole("button", { name: en("guide.done") }));
    expect(await screen.findByText(en("guide.notYet"))).toBeInTheDocument();
  });
});

describe("logout (FR-SYS-092)", () => {
  async function openLogout() {
    await userEvent.click(await screen.findByRole("button", { name: en("my.logout") }));
    return screen.findByRole("button", { name: en("common.confirm") });
  }

  it("Cancel keeps the session (092-02)", async () => {
    const api = signedIn();
    renderAt("/");
    await openLogout();
    await userEvent.click(screen.getByRole("button", { name: en("common.cancel") }));
    expect(screen.getByTestId("page-home")).toBeInTheDocument();
    expect(api.count("POST /api/v1/auth/logout")).toBe(0);
  });

  it("Confirm logs out to the login page, even when the request fails (092-01)", async () => {
    localStorage.setItem("saiflow.pc.tenant.7", "5");
    const api = signedIn({ "POST /api/v1/auth/logout": () => json(500, { code: "internal_error" }) });
    renderAt("/");
    await userEvent.click(await openLogout());
    expect(await screen.findByRole("button", { name: en("login.button") })).toBeInTheDocument();
    expect(api.count("POST /api/v1/auth/logout")).toBe(1);
    expect(localStorage.getItem("saiflow.pc.tenant.7")).toBeNull();
  });

  it("the next user on this browser sees nothing of the previous one (Review Focus 3)", async () => {
    // A's session expires on org 5; B, also a member of org 5, then logs in on this browser.
    localStorage.setItem("saiflow.pc.tenant.7", "5");
    const backend = signedIn({}, { tenants: [PERSONAL, ORG] });
    const first = renderAt("/");
    expect(await screen.findByRole("button", { name: en("tenant.switch") })).toHaveTextContent("Siam Tools");
    backend.set("GET /api/v1/me", () => json(401, { code: "unauthenticated" }));
    backend.set("GET /api/v1/billing/usage", () => json(401, { code: "unauthenticated" }));
    await act(() => call(api.GET("/api/v1/billing/usage")).catch(() => undefined));
    await startLogin();
    const state = JSON.parse(sessionStorage.getItem(LOGIN_STATE_KEY)!).state as string;
    first.unmount();
    backend.set("GET /api/v1/me", () => json(200, OTHER));
    backend.set("GET /api/v1/me/tenants", () => json(200, [{ ...PERSONAL, tenant_id: 80 }, ORG]));
    backend.set("POST /api/v1/auth/line", () => json(200, OTHER));
    // LINE comes back: a fresh page load at the callback.
    renderAt(`/login?code=y&state=${state}`);
    expect(await screen.findByText("Malee")).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: en("tenant.switch") })).toHaveTextContent(en("tenant.personal"));
    expect(screen.queryByText("Somchai")).not.toBeInTheDocument();
  });

  it("after an expiry the same user logs in again and is back in their organization (090-04)", async () => {
    localStorage.setItem("saiflow.pc.tenant.7", "5");
    const backend = signedIn({}, { tenants: [PERSONAL, ORG] });
    const first = renderAt("/");
    expect(await screen.findByRole("button", { name: en("tenant.switch") })).toHaveTextContent("Siam Tools");
    backend.set("GET /api/v1/me", () => json(401, { code: "unauthenticated" }));
    backend.set("GET /api/v1/billing/usage", () => json(401, { code: "unauthenticated" }));
    await act(() => call(api.GET("/api/v1/billing/usage")).catch(() => undefined));
    await startLogin();
    const state = JSON.parse(sessionStorage.getItem(LOGIN_STATE_KEY)!).state as string;
    first.unmount();
    backend.set("GET /api/v1/me", () => json(200, USER));
    backend.set("POST /api/v1/auth/line", () => json(200, USER));
    renderAt(`/login?code=z&state=${state}`);
    expect(await screen.findByRole("button", { name: en("tenant.switch") })).toHaveTextContent("Siam Tools");
    expect(localStorage.getItem("saiflow.pc.tenant.7")).toBe("5");
  });
});
