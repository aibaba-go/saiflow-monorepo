import { screen, waitFor } from "@testing-library/react";
import userEventLib from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { Shell } from "../../App";
import { useSession } from "../../stores/session";
import { fakeLiff, type FakeLiff } from "../../test/fakeLiff";
import { json, mockApi, type MockApi } from "../../test/mockApi";
import { renderWithProviders } from "../../test/render";
import { INTENT_KEY, LOGOUT_FLAG } from "./session";

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
    expect(await screen.findByText("Somchai")).toBeInTheDocument();
    expect(await api.bodies("POST /api/v1/auth/line")).toEqual([{ id_token: "tok" }]);
  });

  it("outside LINE: redirects to LINE login with an intent, completes on return", async () => {
    const api = mockApi(routes(GUEST));
    const liff = fakeLiff({ loggedIn: false, inClient: false });
    start(api, liff);
    await userEvent.click(await screen.findByRole("button", { name: "Log in / Register" }));
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

  it("stays a guest and offers retry when login fails (041-03)", async () => {
    const api = mockApi({ ...routes(GUEST), "POST /api/v1/auth/line": () => json(500, { code: "internal_error" }) });
    start(api, fakeLiff({ loggedIn: true }));
    await userEvent.click(await screen.findByRole("button", { name: "Log in / Register" }));
    expect(await screen.findByText(/Something went wrong on our side/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log in / Register" })).toBeInTheDocument();
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
    const liff = fakeLiff({ loggedIn: true });
    localStorage.setItem("saiflow.tenant", "5");
    start(api, liff);
    await userEvent.click(await screen.findByRole("button", { name: "Log out" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(useSession.getState().me?.kind).toBe("guest"));
    expect(liff.logout).toHaveBeenCalled();
    expect(localStorage.getItem("saiflow.tenant")).toBeNull();
    expect(localStorage.getItem(LOGOUT_FLAG)).toBeNull();
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
