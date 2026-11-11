import { screen, waitFor } from "@testing-library/react";
import userEventLib from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { AppRoutes } from "../App";
import { translate } from "../i18n";
import { useLanguage } from "../stores/language";
import { json, mockApi } from "../test/mockApi";
import { renderWithProviders } from "../test/render";
import { safeNext } from "./session";

const userEvent = userEventLib.setup({ pointerEventsCheck: 0 });
const ME = { admin_id: 1, username: "ops" };
const zh = (k: Parameters<typeof translate>[1]) => translate("zh", k);

beforeEach(() => {
  localStorage.clear();
  useLanguage.getState().setLang("zh");
});

async function logIn() {
  await userEvent.type(await screen.findByLabelText(zh("login.username")), "ops");
  await userEvent.type(screen.getByLabelText(zh("login.password")), "correct-horse-battery");
  await userEvent.click(screen.getByRole("button", { name: zh("login.submit") }));
}

describe("login and session (FR-SYS-060)", () => {
  it("logs in, shows the username, logs out (060-01)", async () => {
    let signedIn = false;
    const api = mockApi({
      "GET /api/v1/admin/me": () => (signedIn ? json(200, ME) : json(401, { code: "unauthenticated" })),
      "POST /api/v1/admin/auth/login": () => {
        signedIn = true;
        return json(200, ME);
      },
      "POST /api/v1/admin/auth/logout": () => {
        signedIn = false;
        return json(204, null);
      },
    });
    renderWithProviders(<AppRoutes />, { route: "/" });
    await logIn();
    expect(await screen.findByText("ops")).toBeInTheDocument();
    expect(await api.bodies("POST /api/v1/admin/auth/login")).toEqual([
      { username: "ops", password: "correct-horse-battery" },
    ]);
    await userEvent.click(screen.getByRole("button", { name: zh("nav.logout") }));
    expect(await screen.findByRole("button", { name: zh("login.submit") })).toBeInTheDocument();
  });

  it("a wrong password stays on the login page with the message (060-02)", async () => {
    mockApi({
      "GET /api/v1/admin/me": () => json(401, { code: "unauthenticated" }),
      "POST /api/v1/admin/auth/login": () => json(401, { code: "admin_login_failed" }),
    });
    renderWithProviders(<AppRoutes />, { route: "/login" });
    await logIn();
    expect(await screen.findByText(zh("err.admin_login_failed"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: zh("login.submit") })).toBeInTheDocument();
  });

  it("an expired session goes to login and comes back to the same page (060-03)", async () => {
    let signedIn = false;
    mockApi({
      "GET /api/v1/admin/me": () => (signedIn ? json(200, ME) : json(401, { code: "unauthenticated" })),
      "POST /api/v1/admin/auth/login": () => {
        signedIn = true;
        return json(200, ME);
      },
      "GET /api/v1/admin/organizations": () => json(200, []),
    });
    renderWithProviders(<AppRoutes />, { route: "/organizations" });
    await logIn();
    await waitFor(() => expect(screen.getByRole("heading", { name: zh("nav.organizations") })).toBeInTheDocument());
  });

  it("a session that expires mid-use goes to login with a notice and comes back (final review I-1, I-2)", async () => {
    let signedIn = true;
    mockApi({
      "GET /api/v1/admin/me": () => (signedIn ? json(200, ME) : json(401, { code: "unauthenticated" })),
      "POST /api/v1/admin/auth/login": () => {
        signedIn = true;
        return json(200, ME);
      },
      "GET /api/v1/admin/organizations": () =>
        signedIn ? json(200, []) : json(401, { code: "unauthenticated" }),
      // the page lists all users on open (FR-SYS-070); the session expires on the search
      "GET /api/v1/admin/users": (r) => {
        if (!new URL(r.url).searchParams.has("q")) return json(200, { items: [], has_more: false });
        signedIn = false;
        return json(401, { code: "unauthenticated" });
      },
    });
    renderWithProviders(<AppRoutes />, { route: "/users" });
    await userEvent.type(await screen.findByPlaceholderText(zh("users.placeholder")), "somchai{Enter}");
    expect(await screen.findByRole("button", { name: zh("login.submit") })).toBeInTheDocument();
    expect(screen.getByText(zh("err.unauthenticated"))).toBeInTheDocument();
    await logIn();
    expect(await screen.findByRole("heading", { name: zh("nav.users") })).toBeInTheDocument();
    expect(screen.queryByText(zh("err.unauthenticated"))).not.toBeInTheDocument();
  });

  it("a first visit without a session shows no expiry notice", async () => {
    mockApi({ "GET /api/v1/admin/me": () => json(401, { code: "unauthenticated" }) });
    renderWithProviders(<AppRoutes />, { route: "/organizations" });
    expect(await screen.findByRole("button", { name: zh("login.submit") })).toBeInTheDocument();
    expect(screen.queryByText(zh("err.unauthenticated"))).not.toBeInTheDocument();
  });

  it("never follows an outside next", () => {
    expect(safeNext("/organizations?status=x")).toBe("/organizations?status=x");
    for (const bad of [null, "", "//evil.com", "https://evil.com", "evil", "/\\evil.com"]) {
      expect(safeNext(bad)).toBe("/");
    }
  });
});
