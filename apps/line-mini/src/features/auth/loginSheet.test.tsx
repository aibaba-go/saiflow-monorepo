import { screen, waitFor, within } from "@testing-library/react";
import userEventLib from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { Shell } from "../../App";
import { useLanguage } from "../../stores/language";
import { useSession } from "../../stores/session";
import { fakeLiff } from "../../test/fakeLiff";
import { json, mockApi, type MockApi } from "../../test/mockApi";
import { renderWithProviders } from "../../test/render";
import { JOIN_KEY, openLogin } from "./session";

const USER = {
  kind: "user",
  user_id: 7,
  tenant_id: 70,
  display_name: "Somchai",
  email: "somchai@example.com",
  email_suggestion: null,
  phone: null,
  avatar_url: null,
  registered: true,
};
const GUEST = { ...USER, kind: "guest", user_id: null, tenant_id: 90, display_name: null, email: null, registered: false };
const PERSONAL = { tenant_id: 70, kind: "personal", name: null, is_owner: true, role: null, permissions: [] };
const userEvent = userEventLib.setup({ pointerEventsCheck: 0 });

function guestApi(extra: Record<string, (r: Request) => Response> = {}): MockApi {
  return mockApi({
    "GET /api/v1/me": () => json(200, GUEST),
    "GET /api/v1/me/tenants": () => json(200, [PERSONAL]),
    "POST /api/v1/auth/guest": () => json(200, GUEST),
    "GET /api/v1/billing/usage": () => json(404, { code: "not_found" }),
    ...extra,
  });
}

/** A login endpoint that signs the user in, as the backend does with its cookie. */
function signsIn(api: MockApi) {
  return () => {
    api.set("GET /api/v1/me", () => json(200, USER));
    return json(200, USER);
  };
}

async function openPanel(api: MockApi) {
  void api;
  renderWithProviders(<Shell liff={fakeLiff({ loggedIn: true })} search="" liffTimeoutMs={50} logoutTimeoutMs={50} />, {
    route: "/my",
  });
  await userEvent.click(await screen.findByRole("button", { name: "Log in / Register" }));
  return screen.findByRole("dialog");
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useSession.getState().reset();
  useLanguage.getState().setLang("en");
});

describe("login panel (FR-SYS-153)", () => {
  it("shows LINE first, the method switch (password by default) and forgot password (153-01)", async () => {
    const panel = await openPanel(guestApi());
    const buttons = within(panel).getAllByRole("button").map((b) => b.textContent);
    expect(buttons.indexOf("Log in with LINE")).toBeLessThan(buttons.indexOf("Forgot password"));
    expect(within(panel).getByRole("tab", { name: "Password" })).toHaveAttribute("aria-selected", "true");
    expect(within(panel).getByRole("tab", { name: "Email code" })).toHaveAttribute("aria-selected", "false");
    expect(within(panel).getByLabelText("Password")).toHaveAttribute("type", "password");
  });

  it("logs in with email and password and stays on My without registration (153-02)", async () => {
    const api = guestApi();
    api.set("POST /api/v1/auth/password", signsIn(api));
    const panel = await openPanel(api);
    await userEvent.type(within(panel).getByLabelText("Email"), "somchai@example.com");
    await userEvent.type(within(panel).getByLabelText("Password"), "abcd1234");
    await userEvent.click(within(panel).getByRole("button", { name: "Log in" }));
    expect(await screen.findByText("Somchai")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(useSession.getState().registerOpen).toBe(false);
    expect(await api.bodies("POST /api/v1/auth/password")).toEqual([
      { email: "somchai@example.com", password: "abcd1234" },
    ]);
  });

  it("logs in with a login code and counts down after sending (153-03)", async () => {
    const api = guestApi({ "POST /api/v1/auth/email-code": () => json(204, null) });
    api.set("POST /api/v1/auth/email-login", signsIn(api));
    const panel = await openPanel(api);
    await userEvent.click(within(panel).getByRole("tab", { name: "Email code" }));
    await userEvent.type(within(panel).getByLabelText("Email"), "somchai@example.com");
    await userEvent.click(within(panel).getByRole("button", { name: "Send code" }));
    expect(await within(panel).findByRole("button", { name: "60s" })).toBeDisabled();
    expect(await api.bodies("POST /api/v1/auth/email-code")).toEqual([
      { email: "somchai@example.com", purpose: "login" },
    ]);
    await userEvent.type(within(panel).getByLabelText("Verification code"), "123456");
    await userEvent.click(within(panel).getByRole("button", { name: "Log in" }));
    await waitFor(() => expect(useSession.getState().me?.kind).toBe("user"));
    expect(await api.bodies("POST /api/v1/auth/email-login")).toEqual([
      { email: "somchai@example.com", code: "123456" },
    ]);
  });

  it("checks the fields before sending", async () => {
    const api = guestApi();
    const panel = await openPanel(api);
    await userEvent.click(within(panel).getByRole("button", { name: "Log in" }));
    expect(await within(panel).findByText("This field is required.")).toBeInTheDocument();
    await userEvent.type(within(panel).getByLabelText("Email"), "not-an-email");
    await userEvent.type(within(panel).getByLabelText("Password"), "x");
    await userEvent.click(within(panel).getByRole("button", { name: "Log in" }));
    expect(await within(panel).findByText("Enter a valid email address.")).toBeInTheDocument();
    expect(api.count("POST /api/v1/auth/password")).toBe(0);
  });

  it("says an email is not registered, and a locked account, keeping what was typed (153-04, 158-01, 158-02)", async () => {
    const api = guestApi({
      "POST /api/v1/auth/password": () =>
        json(404, { code: "email_not_registered", message_key: "x", fields: ["email"] }),
    });
    const panel = await openPanel(api);
    await userEvent.type(within(panel).getByLabelText("Email"), "nobody@example.com");
    await userEvent.type(within(panel).getByLabelText("Password"), "abcd1234");
    await userEvent.click(within(panel).getByRole("button", { name: "Log in" }));
    expect(await within(panel).findByText(/This email isn't registered\. Log in with LINE first/)).toBeInTheDocument();
    expect(within(panel).getByLabelText("Email")).toHaveValue("nobody@example.com");
    expect(within(panel).getByLabelText("Password")).toHaveValue("abcd1234");

    api.set("POST /api/v1/auth/password", () => json(423, { code: "account_locked", message_key: "x", fields: [] }));
    await userEvent.click(within(panel).getByRole("button", { name: "Log in" }));
    expect(await within(panel).findByText(/locked for 5 minutes/)).toBeInTheDocument();
    expect(useSession.getState().me?.kind).toBe("guest");
  });

  it("closing keeps the guest, the page, and cancels a pending confirm (153-05)", async () => {
    const api = guestApi();
    await openPanel(api);
    sessionStorage.setItem("saiflow.confirm-after-login.job-1", "1");
    sessionStorage.setItem(JOIN_KEY, "tok");
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
    expect(sessionStorage.getItem("saiflow.confirm-after-login.job-1")).toBeNull();
    expect(sessionStorage.getItem(JOIN_KEY)).toBeNull();
    expect(useSession.getState().me?.kind).toBe("guest");
    expect(screen.getByRole("button", { name: "Log in / Register" })).toBeInTheDocument();
  });

  it("returns to the page that asked for the login", async () => {
    const api = guestApi();
    api.set("POST /api/v1/auth/password", signsIn(api));
    renderWithProviders(<Shell liff={fakeLiff({ loggedIn: true })} search="" liffTimeoutMs={50} logoutTimeoutMs={50} />, {
      route: "/",
    });
    await screen.findByRole("tab", { name: "My" });
    openLogin("/my");
    const panel = await screen.findByRole("dialog");
    await userEvent.type(within(panel).getByLabelText("Email"), "somchai@example.com");
    await userEvent.type(within(panel).getByLabelText("Password"), "abcd1234");
    await userEvent.click(within(panel).getByRole("button", { name: "Log in" }));
    expect(await screen.findByText("Somchai")).toBeInTheDocument();
  });
});

describe("reset password (FR-SYS-154)", () => {
  async function resetView(api: MockApi) {
    const panel = await openPanel(api);
    await userEvent.click(within(panel).getByRole("button", { name: "Forgot password" }));
    return panel;
  }

  it("resets, logs in and says so (154-01)", async () => {
    const api = guestApi({ "POST /api/v1/auth/email-code": () => json(204, null) });
    api.set("POST /api/v1/auth/password-reset", signsIn(api));
    const panel = await resetView(api);
    await userEvent.type(within(panel).getByLabelText("Email"), "somchai@example.com");
    await userEvent.click(within(panel).getByRole("button", { name: "Send code" }));
    expect(await api.bodies("POST /api/v1/auth/email-code")).toEqual([
      { email: "somchai@example.com", purpose: "reset" },
    ]);
    await userEvent.type(within(panel).getByLabelText("Verification code"), "123456");
    await userEvent.type(within(panel).getByLabelText("New password"), "newpass99");
    await userEvent.type(within(panel).getByLabelText("Confirm new password"), "newpass99");
    await userEvent.click(within(panel).getByRole("button", { name: "Reset and log in" }));
    expect(await screen.findByText("Your password has been reset.")).toBeInTheDocument();
    expect(await screen.findByText("Somchai")).toBeInTheDocument();
    expect(await api.bodies("POST /api/v1/auth/password-reset")).toEqual([
      { email: "somchai@example.com", code: "123456", password: "newpass99" },
    ]);
  });

  it("a mismatch is shown under the confirmation and nothing is sent (154-02)", async () => {
    const api = guestApi();
    const panel = await resetView(api);
    await userEvent.type(within(panel).getByLabelText("Email"), "somchai@example.com");
    await userEvent.type(within(panel).getByLabelText("Verification code"), "123456");
    await userEvent.type(within(panel).getByLabelText("New password"), "newpass99");
    await userEvent.type(within(panel).getByLabelText("Confirm new password"), "newpass98");
    await userEvent.click(within(panel).getByRole("button", { name: "Reset and log in" }));
    expect(await within(panel).findByText("The two passwords don't match.")).toBeInTheDocument();
    expect(api.count("POST /api/v1/auth/password-reset")).toBe(0);
  });

  it("goes back to the login view (154-03)", async () => {
    const panel = await resetView(guestApi());
    await userEvent.click(within(panel).getByRole("button", { name: "Back to login" }));
    expect(within(panel).getByRole("button", { name: "Log in with LINE" })).toBeInTheDocument();
  });
});

describe("error messages in every language (158-03)", () => {
  it.each([
    ["th", "อีเมลนี้ยังไม่ได้ลงทะเบียน"],
    ["zh", "该邮箱未注册"],
  ] as const)("%s", async (lang, text) => {
    useLanguage.getState().setLang(lang);
    guestApi({
      "POST /api/v1/auth/password": () =>
        json(404, { code: "email_not_registered", message_key: "x", fields: ["email"] }),
    });
    renderWithProviders(<Shell liff={fakeLiff({ loggedIn: true })} search="" liffTimeoutMs={50} logoutTimeoutMs={50} />, {
      route: "/my",
    });
    await waitFor(() => expect(useSession.getState().status).toBe("ready"));
    openLogin("/my");
    const panel = await screen.findByRole("dialog");
    const inputs = panel.querySelectorAll("input");
    await userEvent.type(inputs[0]!, "nobody@example.com");
    await userEvent.type(inputs[1]!, "abcd1234");
    await userEvent.click(within(panel).getAllByRole("button").find((b) => b.getAttribute("type") === "submit")!);
    expect(await within(panel).findByText(new RegExp(text))).toBeInTheDocument();
    expect(within(panel).queryByText(/email_not_registered/)).toBeNull();
  });
});
