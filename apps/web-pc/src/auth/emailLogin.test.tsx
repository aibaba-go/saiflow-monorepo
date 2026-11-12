import { screen, waitFor, within } from "@testing-library/react";
import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLanguage } from "../stores/language";
import { useTenantChoice } from "../tenants/useCurrentTenant";
import { en, renderAt, userEvent } from "../test/app";
import { USER } from "../test/fixtures";
import { json, mockApi, type MockApi } from "../test/mockApi";
import { translate } from "../i18n";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useLanguage.getState().setLang("en");
  useTenantChoice.getState().reset();
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

/** No session until one of the login calls succeeds. */
function backend(routes: Record<string, (r: Request) => Response | Promise<Response>> = {}): MockApi {
  let me: unknown = null;
  const signIn = () => {
    me = USER;
    return json(200, USER);
  };
  return mockApi({
    "GET /api/v1/me": () => (me ? json(200, me) : json(401, { code: "unauthenticated" })),
    "GET /api/v1/me/tenants": () => json(200, []),
    "GET /api/v1/me/notifications": () => json(200, { items: [], unread_count: 0, next_before: null }),
    "POST /api/v1/auth/email-code": () => json(204, null),
    "POST /api/v1/auth/password": signIn,
    "POST /api/v1/auth/email-login": signIn,
    "POST /api/v1/auth/password-reset": signIn,
    ...routes,
  });
}

const endsWith = (text: string) => new RegExp(`${text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`);

const field = (key: Parameters<typeof en>[0]) => screen.getByLabelText(en(key));

describe("email login on web-pc (FR-SYS-090)", () => {
  it("the login page offers LINE, password (default), code and forgot password", async () => {
    backend();
    renderAt("/login");
    expect(await screen.findByRole("button", { name: en("login.button") })).toBeInTheDocument();
    const methods = screen.getByLabelText(en("login.method"));
    expect(within(methods).getByText(en("login.byPassword"))).toBeInTheDocument();
    expect(within(methods).getByText(en("login.byCode"))).toBeInTheDocument();
    expect(field("login.password")).toHaveAttribute("type", "password");
    expect(screen.getByRole("link", { name: en("login.forgot") })).toHaveAttribute("href", "/reset-password?next=%2F");
  });

  it("email + password from /plans lands on /plans (090-05)", async () => {
    const api = backend();
    renderAt("/plans");
    await userEvent.type(await screen.findByLabelText(en("login.email")), "somchai@example.com");
    await userEvent.type(field("login.password"), "secret123");
    await userEvent.click(screen.getByRole("button", { name: en("login.submit") }));
    expect(await screen.findByTestId("page-plans")).toBeInTheDocument();
    expect(await screen.findByText("Somchai")).toBeInTheDocument();
    expect(await api.bodies("POST /api/v1/auth/password")).toEqual([
      { email: "somchai@example.com", password: "secret123" },
    ]);
  });

  it("email + code: 60 s countdown, then home (090-06)", async () => {
    const api = backend();
    renderAt("/login");
    await userEvent.click(await screen.findByText(en("login.byCode")));
    await userEvent.type(screen.getByLabelText(en("login.email")), "somchai@example.com");
    await userEvent.click(screen.getByRole("button", { name: en("profile.sendCode") }));
    // antd keeps the fading loading icon (aria-label "loading") in jsdom, so match the end
    expect(await screen.findByRole("button", { name: endsWith(en("common.secondsLeft", { n: 60 })) })).toBeDisabled();
    expect(await api.bodies("POST /api/v1/auth/email-code")).toEqual([
      { email: "somchai@example.com", purpose: "login" },
    ]);
    await userEvent.type(field("login.code"), "123456");
    await userEvent.click(screen.getByRole("button", { name: en("login.submit") }));
    expect(await screen.findByTestId("page-home")).toBeInTheDocument();
    expect(await api.bodies("POST /api/v1/auth/email-login")).toEqual([
      { email: "somchai@example.com", code: "123456" },
    ]);
  });

  it("unregistered email and wrong password stay, keep the email and are not an expiry (090-07)", async () => {
    const api = backend({
      "POST /api/v1/auth/password": () =>
        json(404, { code: "email_not_registered", message_key: "x", fields: ["email"] }),
    });
    renderAt("/login");
    await userEvent.type(await screen.findByLabelText(en("login.email")), "nobody@example.com");
    await userEvent.type(field("login.password"), "secret123");
    await userEvent.click(screen.getByRole("button", { name: en("login.submit") }));
    expect(await screen.findByText(en("err.email_not_registered"))).toBeInTheDocument();
    expect(en("err.email_not_registered")).toMatch(/LINE mini app/);

    api.set("POST /api/v1/auth/password", () =>
      json(401, { code: "password_invalid", message_key: "x", fields: ["password"] }),
    );
    await userEvent.click(screen.getByRole("button", { name: en("login.submit") }));
    expect(await screen.findByText(en("err.password_invalid"))).toBeInTheDocument();
    expect(screen.getByLabelText(en("login.email"))).toHaveValue("nobody@example.com");
    expect(screen.queryByText(en("err.session_expired"))).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: en("login.submit") })).toBeInTheDocument();
  });

  it("a locked account says so at the form level", async () => {
    backend({ "POST /api/v1/auth/password": () => json(423, { code: "account_locked", message_key: "x", fields: [] }) });
    renderAt("/login");
    await userEvent.type(await screen.findByLabelText(en("login.email")), "somchai@example.com");
    await userEvent.type(field("login.password"), "secret123");
    await userEvent.click(screen.getByRole("button", { name: en("login.submit") }));
    expect(await screen.findByText(en("err.account_locked"))).toBeInTheDocument();
  });

  it("empty or malformed fields are flagged and nothing is sent", async () => {
    const api = backend();
    renderAt("/login");
    await userEvent.click(await screen.findByRole("button", { name: en("login.submit") }));
    expect(await screen.findByText(en("field.required"))).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(en("login.email")), "not-an-email");
    await userEvent.click(screen.getByRole("button", { name: en("login.submit") }));
    expect(await screen.findByText(en("field.email"))).toBeInTheDocument();
    expect(api.count("POST /api/v1/auth/password")).toBe(0);
  });
});

describe("reset password page (FR-SYS-155)", () => {
  async function fillReset(password: string, confirm: string) {
    await userEvent.type(await screen.findByLabelText(en("login.email")), "somchai@example.com");
    await userEvent.click(screen.getByRole("button", { name: en("profile.sendCode") }));
    await userEvent.type(field("login.code"), "654321");
    await userEvent.type(field("login.newPassword"), password);
    await userEvent.type(field("login.newPasswordConfirm"), confirm);
    await userEvent.click(screen.getByRole("button", { name: en("login.resetSubmit") }));
  }

  it("forgot password → reset and log in → home (155-01)", async () => {
    const api = backend();
    renderAt("/login");
    await userEvent.click(await screen.findByRole("link", { name: en("login.forgot") }));
    expect(await screen.findByText(en("login.resetHint"))).toBeInTheDocument();
    await fillReset("newpass123", "newpass123");
    expect(await screen.findByText(en("login.resetDone"))).toBeInTheDocument();
    expect(await screen.findByTestId("page-home")).toBeInTheDocument();
    expect(await screen.findByText("Somchai")).toBeInTheDocument();
    expect(await api.bodies("POST /api/v1/auth/email-code")).toEqual([
      { email: "somchai@example.com", purpose: "reset" },
    ]);
    expect(await api.bodies("POST /api/v1/auth/password-reset")).toEqual([
      { email: "somchai@example.com", code: "654321", password: "newpass123" },
    ]);
  });

  it("checks the rule and the confirmation before sending (155-02)", async () => {
    const api = backend();
    renderAt("/reset-password");
    await fillReset("12345678", "12345678");
    expect(await screen.findByText(en("field.password"))).toBeInTheDocument();
    await userEvent.clear(field("login.newPassword"));
    await userEvent.type(field("login.newPassword"), "newpass123");
    await userEvent.clear(field("login.newPasswordConfirm"));
    await userEvent.type(field("login.newPasswordConfirm"), "newpass124");
    await userEvent.click(screen.getByRole("button", { name: en("login.resetSubmit") }));
    expect(await screen.findByText(en("err.password_mismatch"))).toBeInTheDocument();
    expect(api.count("POST /api/v1/auth/password-reset")).toBe(0);
  });

  it("an unregistered email says so when sending the code (155-03)", async () => {
    backend({
      "POST /api/v1/auth/email-code": () =>
        json(404, { code: "email_not_registered", message_key: "x", fields: ["email"] }),
    });
    renderAt("/reset-password");
    await userEvent.type(await screen.findByLabelText(en("login.email")), "nobody@example.com");
    await userEvent.click(screen.getByRole("button", { name: en("profile.sendCode") }));
    expect(await screen.findByText(en("err.email_not_registered"))).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: endsWith(en("profile.sendCode")) })).toBeEnabled();
  });

  it("back to login keeps where to go; login then lands on /plans (155-04)", async () => {
    backend();
    renderAt("/plans");
    await userEvent.click(await screen.findByRole("link", { name: en("login.forgot") }));
    await userEvent.click(await screen.findByRole("link", { name: en("login.backToLogin") }));
    await userEvent.type(await screen.findByLabelText(en("login.email")), "somchai@example.com");
    await userEvent.type(field("login.password"), "secret123");
    await userEvent.click(screen.getByRole("button", { name: en("login.submit") }));
    expect(await screen.findByTestId("page-plans")).toBeInTheDocument();
  });

  it("an outside next is ignored", async () => {
    backend();
    renderAt("/reset-password?next=%2F%2Fevil.com");
    await fillReset("newpass123", "newpass123");
    expect(await screen.findByTestId("page-home")).toBeInTheDocument();
  });

  it("is translated (FR-SYS-093)", async () => {
    backend();
    renderAt("/reset-password");
    await screen.findByLabelText(en("login.email"));
    act(() => useLanguage.getState().setLang("th"));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: translate("th", "login.resetSubmit") })).toBeInTheDocument(),
    );
  });
});
