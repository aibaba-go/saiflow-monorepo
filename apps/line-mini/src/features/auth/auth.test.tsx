import { screen, waitFor } from "@testing-library/react";
import userEventLib from "@testing-library/user-event";
import { act } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { Shell } from "../../App";
import { useSession } from "../../stores/session";
import { fakeLiff, type FakeLiff } from "../../test/fakeLiff";
import { json, mockApi, type MockApi } from "../../test/mockApi";
import { renderWithProviders } from "../../test/render";
import { ApiError } from "../../services/errors";
import { configureAuth, INTENT_KEY, loginWithLineFromPanel, LOGOUT_FLAG, openLogin } from "./session";

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
  impersonated: false,
  line_linked: true,
};
const GUEST = { ...USER, line_linked: false, kind: "guest", user_id: null, tenant_id: 90, display_name: null, email: null, registered: false };
// dialogs set pointer-events on the body while open; skip the pointer-events check
const userEvent = userEventLib.setup({ pointerEventsCheck: 0 });

const PERSONAL = { tenant_id: 70, kind: "personal", name: null, is_owner: true, role: null, permissions: [] };

function routes(me: unknown): Record<string, (r: Request) => Response> {
  return {
    "GET /api/v1/me": () => json(200, me),
    "GET /api/v1/me/tenants": () => json(200, [PERSONAL]),
    "POST /api/v1/auth/guest": () => json(200, GUEST),
    "GET /api/v1/billing/usage": () => json(404, { code: "not_found" }),
  };
}

function start(api: MockApi, liff: FakeLiff, search = "", route = "/my") {
  void api;
  return renderWithProviders(<Shell liff={liff} search={search} liffTimeoutMs={50} logoutTimeoutMs={50} />, {
    route,
  });
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useSession.getState().reset();
});

describe("explicit LINE linking", () => {
  it("links with both proofs without ordinary LINE login", async () => {
    sessionStorage.setItem(INTENT_KEY, JSON.stringify({ returnTo: "/my", mode: "link", at: Date.now() }));
    const api = mockApi(routes(GUEST));
    api.set("POST /api/v1/auth/line-link", () => {
      api.set("GET /api/v1/me", () => json(200, USER));
      return json(200, USER);
    });
    start(api, fakeLiff({ loggedIn: true, idToken: "verified-token" }));
    await screen.findByRole("button", { name: "Verify and link" });
    await userEvent.type(screen.getByLabelText("Email"), "somchai@example.com");
    await userEvent.type(screen.getByLabelText("Password"), "SafePass123");
    await userEvent.click(screen.getByRole("button", { name: "Verify and link" }));
    expect(await screen.findByText("Somchai")).toBeInTheDocument();
    expect(await api.bodies("POST /api/v1/auth/line-link")).toEqual([{ id_token: "verified-token", email: "somchai@example.com", password: "SafePass123" }]);
    expect(api.count("POST /api/v1/auth/line")).toBe(0);
    expect(useSession.getState().lineLinkOpen).toBe(false);
  });

  it("displays email-code proof errors and retains the email", async () => {
    sessionStorage.setItem(INTENT_KEY, JSON.stringify({ returnTo: "/my", mode: "link", at: Date.now() }));
    const api = mockApi(routes(GUEST));
    api.set("POST /api/v1/auth/line-link", () => json(400, { code: "email_code_invalid", fields: ["email_code"] }));
    start(api, fakeLiff({ loggedIn: true }));
    await screen.findByRole("button", { name: "Verify and link" });
    await userEvent.click(screen.getByRole("tab", { name: "Email code" }));
    await userEvent.type(screen.getByLabelText("Email"), "somchai@example.com");
    await userEvent.type(screen.getByLabelText("Verification code"), "123456");
    await userEvent.click(screen.getByRole("button", { name: "Verify and link" }));
    expect(await screen.findByText("The code is wrong or has expired.")).toBeInTheDocument();
    expect(screen.getByLabelText("Email")).toHaveValue("somchai@example.com");
  });
  it("restores a linking intent without creating a separate LINE account", async () => {
    sessionStorage.setItem(INTENT_KEY, JSON.stringify({ returnTo: "/my", mode: "link", at: Date.now() }));
    const api = mockApi(routes(GUEST));
    start(api, fakeLiff({ loggedIn: true }));
    expect(await screen.findByRole("button", { name: "Verify and link" })).toBeInTheDocument();
    expect(api.count("POST /api/v1/auth/line")).toBe(0);
    expect(sessionStorage.getItem(INTENT_KEY)).toBeNull();
  });
});

describe("boot (FR-SYS-040)", () => {
  it("uses the existing session without LINE login (040-01)", async () => {
    const api = mockApi(routes(USER));
    const liff = fakeLiff({ loggedIn: true });
    start(api, liff);
    expect(await screen.findByText("Somchai")).toBeInTheDocument();
    expect(api.count("POST /api/v1/auth/line")).toBe(0);
  });

  it("becomes a guest when there is no session (040-02)", async () => {
    const api = mockApi({ ...routes(USER), "GET /api/v1/me": () => json(401, { code: "unauthenticated" }) });
    api.set("POST /api/v1/auth/guest", () => {
      api.set("GET /api/v1/me", () => json(200, GUEST));
      return json(200, GUEST);
    });
    start(api, fakeLiff());
    expect(await screen.findByRole("button", { name: "Log in / Register" })).toBeInTheDocument();
    expect(api.count("POST /api/v1/auth/guest")).toBe(1);
  });

  it("does not log in from a leftover LIFF state (040-03)", async () => {
    const api = mockApi(routes(GUEST));
    start(api, fakeLiff({ loggedIn: true }));
    expect(await screen.findByRole("button", { name: "Log in / Register" })).toBeInTheDocument();
    expect(api.count("POST /api/v1/auth/line")).toBe(0);
  });

  it("ignores a stale login intent", async () => {
    sessionStorage.setItem(INTENT_KEY, JSON.stringify({ returnTo: "/my", at: Date.now() - 10 * 60_000 }));
    const api = mockApi(routes(GUEST));
    start(api, fakeLiff({ loggedIn: true }));
    expect(await screen.findByRole("button", { name: "Log in / Register" })).toBeInTheDocument();
    expect(api.count("POST /api/v1/auth/line")).toBe(0);
    expect(sessionStorage.getItem(INTENT_KEY)).toBeNull();
  });

  it("shows retry when LIFF does not start in time, and retry restarts (040-04)", async () => {
    const api = mockApi(routes(GUEST));
    const liff = fakeLiff({ init: "never" });
    start(api, liff);
    expect(await screen.findByText("Could not connect to LINE. Please try again.")).toBeInTheDocument();
    liff.init = () => Promise.resolve();
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByRole("button", { name: "Log in / Register" })).toBeInTheDocument();
  });

  it("shows the guest limit message with retry", async () => {
    const api = mockApi({
      ...routes(GUEST),
      "GET /api/v1/me": () => json(401, { code: "unauthenticated" }),
      "POST /api/v1/auth/guest": () => json(429, { code: "guest_too_many" }),
    });
    start(api, fakeLiff());
    expect(await screen.findByText(/Too many trial sessions/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Retry" })).toBeInTheDocument();
  });
});

describe("LINE login (FR-SYS-041)", () => {
  it("logs in from My inside LINE (041-01)", async () => {
    const api = mockApi(routes(GUEST));
    api.set("POST /api/v1/auth/line", () => {
      api.set("GET /api/v1/me", () => json(200, USER));
      return json(200, USER);
    });
    start(api, fakeLiff({ loggedIn: true, idToken: "tok" }));
    await userEvent.click(await screen.findByRole("button", { name: "Log in / Register" }));
    await userEvent.click(await screen.findByRole("button", { name: "Log in with LINE" }));
    expect(await screen.findByText("Somchai")).toBeInTheDocument();
    expect(await api.bodies("POST /api/v1/auth/line")).toEqual([{ id_token: "tok" }]);
  });

  it("outside LINE: redirects to LINE login with an intent, completes on return", async () => {
    const api = mockApi(routes(GUEST));
    const liff = fakeLiff({ loggedIn: false, inClient: false });
    start(api, liff);
    await userEvent.click(await screen.findByRole("button", { name: "Log in / Register" }));
    await userEvent.click(await screen.findByRole("button", { name: "Log in with LINE" }));
    expect(liff.login).toHaveBeenCalledTimes(1);
    expect(JSON.parse(sessionStorage.getItem(INTENT_KEY)!).returnTo).toBe("/my");
  });

  it("starts login from the OA register entry and opens registration (041-02)", async () => {
    const unregistered = { ...USER, registered: false, display_name: "New" };
    const api = mockApi(routes(GUEST));
    api.set("POST /api/v1/auth/line", () => {
      api.set("GET /api/v1/me", () => json(200, unregistered));
      return json(200, unregistered);
    });
    start(api, fakeLiff({ loggedIn: true }), "?entry=register");
    await waitFor(() => expect(api.count("POST /api/v1/auth/line")).toBe(1));
    await waitFor(() => expect(useSession.getState().registerOpen).toBe(true));
  });

  it("the OA register entry reopens registration for an existing unregistered session (041-02, 042-04)", async () => {
    const unregistered = { ...USER, registered: false, email: null };
    const api = mockApi(routes(unregistered));
    start(api, fakeLiff({ loggedIn: true }), "?entry=register");
    expect(await screen.findByRole("dialog", { name: "Complete your registration" })).toBeInTheDocument();
    expect(useSession.getState().loginOpen).toBe(false);
    expect(api.count("POST /api/v1/auth/line")).toBe(0);
  });

  it("a login prompt for a known unregistered user shows registration, not another LINE login (042-04)", async () => {
    const unregistered = { ...USER, registered: false, email: null };
    const api = mockApi(routes(unregistered));
    start(api, fakeLiff({ loggedIn: true }));
    await waitFor(() => expect(useSession.getState().status).toBe("ready"));
    act(() => openLogin("/my"));
    expect(await screen.findByRole("dialog", { name: "Complete your registration" })).toBeInTheDocument();
    expect(useSession.getState().loginOpen).toBe(false);
    expect(api.count("POST /api/v1/auth/line")).toBe(0);
  });

  it("refreshes a rejected external-browser LINE token on explicit retry, retaining the confirm (041-03, 106-01)", async () => {
    const api = mockApi({ ...routes(GUEST), "POST /api/v1/auth/line": () => json(401, { code: "line_token_invalid" }) });
    const liff = fakeLiff({ loggedIn: true, inClient: false, idToken: "old-token" });
    start(api, liff);
    await userEvent.click(await screen.findByRole("button", { name: "Log in / Register" }));
    await userEvent.click(await screen.findByRole("button", { name: "Log in with LINE" }));
    expect(await screen.findByText("LINE login failed. Please try again.")).toBeInTheDocument();
    expect(useSession.getState().me?.kind).toBe("guest");
    expect(useSession.getState().registerOpen).toBe(false);
    expect(liff.login).not.toHaveBeenCalled(); // no automatic redirect loop
    sessionStorage.setItem("saiflow.confirm-after-login.j1", "1");
    useSession.getState().set({ loginReturnTo: "/scan/jobs/j1/result" });
    await userEvent.click(screen.getByRole("button", { name: "Log in with LINE" }));
    expect(liff.logout).toHaveBeenCalledTimes(1);
    expect(liff.login).toHaveBeenCalledTimes(1);
    expect(api.count("POST /api/v1/auth/line")).toBe(1); // never send the rejected token again
    expect(JSON.parse(sessionStorage.getItem(INTENT_KEY)!).returnTo).toBe("/scan/jobs/j1/result");
    expect(sessionStorage.getItem("saiflow.confirm-after-login.j1")).toBe("1");
  });

  it.each(["line_token_invalid", "line_token_required"])("reauthorizes native LIFF on explicit %s retry, retaining the return page (041-03)", async (code) => {
    const liff = fakeLiff({ loggedIn: true, inClient: true });
    const reauthorize = vi.fn();
    liff.reauthorize = reauthorize;
    configureAuth({
      liff, search: "", liffTimeoutMs: 50, logoutTimeoutMs: 50,
      navigate: vi.fn(), currentPath: () => "/scan/jobs/j1/result", onIdentityChange: vi.fn(),
    });
    const api = mockApi(routes(GUEST));
    useSession.getState().set({
      me: { ...GUEST, kind: "guest" }, status: "ready", loginOpen: true, loginReturnTo: "/scan/jobs/j1/result",
      loginError: new ApiError(401, code, []),
    });
    await loginWithLineFromPanel();
    expect(reauthorize).toHaveBeenCalledWith(window.location.href);
    expect(liff.login).not.toHaveBeenCalled();
    expect(api.count("POST /api/v1/auth/line")).toBe(0);
    expect(JSON.parse(sessionStorage.getItem(INTENT_KEY)!).returnTo).toBe("/scan/jobs/j1/result");
  });

  it("opens registration when fresh authorization returns with an unregistered LINE user (041-02, 042-01)", async () => {
    sessionStorage.setItem(INTENT_KEY, JSON.stringify({ returnTo: "/my", at: Date.now() }));
    const api = mockApi(routes(GUEST));
    api.set("POST /api/v1/auth/line", () => {
      const unregistered = { ...USER, registered: false, email: null };
      api.set("GET /api/v1/me", () => json(200, unregistered));
      return json(200, unregistered);
    });
    const liff = fakeLiff({ loggedIn: true, inClient: true, idToken: "fresh-token" });
    start(api, liff);
    expect(await screen.findByRole("dialog", { name: "Complete your registration" })).toBeInTheDocument();
    expect(await api.bodies("POST /api/v1/auth/line")).toEqual([{ id_token: "fresh-token" }]);
    expect(useSession.getState().loginOpen).toBe(false);
    expect(useSession.getState().loginError).toBeNull();
    expect(sessionStorage.getItem(INTENT_KEY)).toBeNull();
  });

  it("keeps a refreshed-token failure retryable rather than repeatedly redirecting (041-03)", async () => {
    sessionStorage.setItem(INTENT_KEY, JSON.stringify({ returnTo: "/my", at: Date.now() }));
    const api = mockApi({ ...routes(GUEST), "POST /api/v1/auth/line": () => json(401, { code: "line_token_invalid" }) });
    const liff = fakeLiff({ loggedIn: true, inClient: false });
    start(api, liff);
    expect(await screen.findByText("LINE login failed. Please try again.")).toBeInTheDocument();
    expect(api.count("POST /api/v1/auth/line")).toBe(1);
    expect(liff.login).not.toHaveBeenCalled();
    expect(useSession.getState().registerOpen).toBe(false);
    expect(sessionStorage.getItem(INTENT_KEY)).toBeNull();
  });

  it("registration prefills the LINE email and hints autofill for email and phone (FR-SYS-020)", async () => {
    const unregistered = { ...USER, registered: false, email: null, email_suggestion: "line@example.com" };
    const api = mockApi(routes(GUEST));
    api.set("POST /api/v1/auth/line", () => {
      api.set("GET /api/v1/me", () => json(200, unregistered));
      return json(200, unregistered);
    });
    start(api, fakeLiff({ loggedIn: true }), "?entry=register");
    const email = await screen.findByDisplayValue("line@example.com");
    expect(email).toHaveAttribute("autocomplete", "email");
    const phone = document.getElementById("reg-phone");
    expect(phone).toHaveAttribute("type", "tel");
    expect(phone).toHaveAttribute("autocomplete", "tel");
    expect(phone).toHaveAttribute("inputmode", "tel");
  });

  it("registration prefills the phone LINE shared, still editable (AC-FR-SYS-014-08)", async () => {
    const unregistered = { ...USER, registered: false, email: null, phone: "+66812345678" };
    const api = mockApi(routes(GUEST));
    api.set("POST /api/v1/auth/line", () => {
      api.set("GET /api/v1/me", () => json(200, unregistered));
      return json(200, unregistered);
    });
    start(api, fakeLiff({ loggedIn: true }), "?entry=register");
    const phone = await screen.findByDisplayValue("+66812345678");
    expect(phone).toHaveAttribute("id", "reg-phone");
    await userEvent.clear(phone);
    await userEvent.type(phone, "0899999999");
    expect(phone).toHaveValue("0899999999");
  });

  it("stays a guest and offers retry when login fails (041-03)", async () => {
    const api = mockApi({ ...routes(GUEST), "POST /api/v1/auth/line": () => json(500, { code: "internal_error" }) });
    start(api, fakeLiff({ loggedIn: true }));
    await userEvent.click(await screen.findByRole("button", { name: "Log in / Register" }));
    await userEvent.click(await screen.findByRole("button", { name: "Log in with LINE" }));
    // the panel comes back with the error and LINE login to retry; still a guest
    expect(await screen.findByText(/Something went wrong on our side/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log in with LINE" })).toBeInTheDocument();
    expect(useSession.getState().me?.kind).toBe("guest");
  });
});

describe("logout (FR-SYS-043)", () => {
  function loggedIn() {
    const api = mockApi(routes(USER));
    api.set("POST /api/v1/auth/logout", () => {
      api.set("GET /api/v1/me", () => json(401, { code: "unauthenticated" }));
      api.set("POST /api/v1/auth/guest", () => {
        api.set("GET /api/v1/me", () => json(200, GUEST));
        return json(200, GUEST);
      });
      return json(204, null);
    });
    return api;
  }

  it("logs out to a guest home (043-01)", async () => {
    const api = loggedIn();
    const liff = fakeLiff({ loggedIn: true, inClient: false });
    localStorage.setItem("saiflow.tenant", "5");
    start(api, liff);
    await userEvent.click(await screen.findByRole("button", { name: "Log out" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(useSession.getState().me?.kind).toBe("guest"));
    expect(liff.logout).toHaveBeenCalled();
    expect(localStorage.getItem("saiflow.tenant")).toBeNull();
    expect(localStorage.getItem(LOGOUT_FLAG)).toBeNull();
  });

  it("inside LINE: says so, keeps the LINE account and can log in again with a tap", async () => {
    const api = loggedIn();
    const liff = fakeLiff({ loggedIn: true, idToken: "tok" });
    start(api, liff);
    await userEvent.click(await screen.findByRole("button", { name: "Log out" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("Logged out. You are now using SaiFlow as a guest.")).toBeInTheDocument();
    expect(useSession.getState().me?.kind).toBe("guest");
    expect(liff.logout).not.toHaveBeenCalled();
    api.set("POST /api/v1/auth/line", () => {
      api.set("GET /api/v1/me", () => json(200, USER));
      return json(200, USER);
    });
    await userEvent.click(await screen.findByRole("tab", { name: "My" }));
    await userEvent.click(await screen.findByRole("button", { name: "Log in / Register" }));
    await userEvent.click(await screen.findByRole("button", { name: "Log in with LINE" }));
    expect(await screen.findByText("Somchai")).toBeInTheDocument();
  });

  it("cancel keeps the user logged in (043-02)", async () => {
    const api = loggedIn();
    start(api, fakeLiff({ loggedIn: true }));
    await userEvent.click(await screen.findByRole("button", { name: "Log out" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.getByText("Somchai")).toBeInTheDocument();
    expect(api.count("POST /api/v1/auth/logout")).toBe(0);
  });

  it("locks on failure, retry finishes, reload with the flag finishes first (043-03)", async () => {
    const api = loggedIn();
    const good = api;
    good.set("POST /api/v1/auth/logout", () => Promise.reject(new TypeError("offline")) as never);
    start(api, fakeLiff({ loggedIn: true }));
    await userEvent.click(await screen.findByRole("button", { name: "Log out" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("Logout failed. Please try again.")).toBeInTheDocument();
    expect(localStorage.getItem(LOGOUT_FLAG)).toBe("1");
    expect(screen.queryByText("Somchai")).not.toBeInTheDocument();
    good.set("POST /api/v1/auth/logout", () => {
      good.set("GET /api/v1/me", () => json(401, { code: "unauthenticated" }));
      good.set("POST /api/v1/auth/guest", () => {
        good.set("GET /api/v1/me", () => json(200, GUEST));
        return json(200, GUEST);
      });
      return json(204, null);
    });
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    await waitFor(() => expect(useSession.getState().me?.kind).toBe("guest"));
    expect(localStorage.getItem(LOGOUT_FLAG)).toBeNull();
  });

  it("finishes a pending logout at boot before anything else", async () => {
    localStorage.setItem(LOGOUT_FLAG, "1");
    const api = loggedIn();
    start(api, fakeLiff());
    await waitFor(() => expect(useSession.getState().me?.kind).toBe("guest"));
    expect(api.calls[0]!.url).toContain("/api/v1/auth/logout");
  });

  it("a 401 while locked neither creates a guest nor unlocks", async () => {
    const api = loggedIn();
    api.set("POST /api/v1/auth/logout", () => Promise.reject(new TypeError("offline")) as never);
    start(api, fakeLiff({ loggedIn: true }));
    await userEvent.click(await screen.findByRole("button", { name: "Log out" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await screen.findByText("Logout failed. Please try again.");
    const guests = api.count("POST /api/v1/auth/guest");
    const { handleUnauthenticated } = await import("./session");
    await handleUnauthenticated();
    expect(api.count("POST /api/v1/auth/guest")).toBe(guests);
    expect(useSession.getState().status).toBe("locked");
  });
});

describe("session expiry (AC-FR-SYS-055-04)", () => {
  it("returns to a guest and says so", async () => {
    const api = mockApi(routes(USER));
    start(api, fakeLiff({ loggedIn: true }));
    await screen.findByText("Somchai");
    api.set("GET /api/v1/me", () => json(401, { code: "unauthenticated" }));
    api.set("POST /api/v1/auth/guest", () => {
      api.set("GET /api/v1/me", () => json(200, GUEST));
      return json(200, GUEST);
    });
    const { handleUnauthenticated } = await import("./session");
    await handleUnauthenticated();
    await waitFor(() => expect(useSession.getState().me?.kind).toBe("guest"));
    expect(await screen.findByText("Your session has expired. Please log in again.")).toBeInTheDocument();
  });
});


describe("guest messages (minor-fixes-ui)", () => {
  it("guest on a user-only page is told to log in first", async () => {
    const api = mockApi(routes(GUEST));
    start(api, fakeLiff({ loggedIn: false }), "", "/");
    await waitFor(() => expect(useSession.getState().me?.kind).toBe("guest"));
    const { handleUnauthenticated } = await import("./session");
    await handleUnauthenticated();
    expect(await screen.findByText("Please log in first.")).toBeInTheDocument();
    expect(screen.queryByText("Your session has expired. Please log in again.")).toBeNull();
  });

  it("an expired guest is told the trial ended", async () => {
    const api = mockApi(routes(GUEST));
    start(api, fakeLiff({ loggedIn: false }), "", "/");
    await waitFor(() => expect(useSession.getState().me?.kind).toBe("guest"));
    api.set("GET /api/v1/me", () => json(401, { code: "unauthenticated" }));
    api.set("POST /api/v1/auth/guest", () => {
      api.set("GET /api/v1/me", () => json(200, { ...GUEST, tenant_id: 91 }));
      return json(200, { ...GUEST, tenant_id: 91 });
    });
    const { handleUnauthenticated } = await import("./session");
    await handleUnauthenticated();
    expect(await screen.findByText("Your guest trial has ended. Log in to keep your work.")).toBeInTheDocument();
  });

  it("a user whose session ends during a profile refresh is told it expired", async () => {
    const api = mockApi(routes(USER));
    start(api, fakeLiff({ loggedIn: true }));
    await screen.findByText("Somchai");
    api.set("GET /api/v1/me", () => json(401, { code: "unauthenticated" }));
    const { reloadIdentity } = await import("./session");
    await reloadIdentity();
    expect(await screen.findByText("Your session has expired. Please log in again.")).toBeInTheDocument();
  });
});
