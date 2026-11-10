/** Final review fixes (line-mini-account): Important 1-3. */
import { screen, waitFor } from "@testing-library/react";
import userEventLib from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLanguage } from "../stores/language";
import { useSession } from "../stores/session";
import { testAuth } from "../test/auth";
import { fakeLiff } from "../test/fakeLiff";
import { GUEST, ORG, PERSONAL, signedIn, USER } from "../test/fixtures";
import { json, mockApi } from "../test/mockApi";
import { renderWithProviders } from "../test/render";
import { handleUnauthenticated, logout } from "./auth/session";
import { INVITE_KEY, InvitePage } from "./invite/InvitePage";
import { OrgPage } from "./orgs/OrgPage";
import { useTenantChoice } from "./tenants/useCurrentTenant";

const userEvent = userEventLib.setup({ pointerEventsCheck: 0 });

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useLanguage.getState().setLang("en");
  useTenantChoice.getState().choose(null);
});

describe("Important 1: a 401 during logout", () => {
  it("does not start a second guest session or say the session expired", async () => {
    testAuth();
    const api = mockApi({
      "POST /api/v1/auth/logout": async () => {
        // a query of the old identity answers 401 while the logout is under way
        await handleUnauthenticated();
        return json(204, null);
      },
      "GET /api/v1/me": () => json(401, { code: "unauthenticated" }),
      "POST /api/v1/auth/guest": () => json(200, GUEST),
    });
    signedIn(USER, [PERSONAL, ORG]);
    await logout();
    expect(api.count("POST /api/v1/auth/guest")).toBe(1);
    expect(useSession.getState().me?.kind).toBe("guest");
    expect(useSession.getState().notice).toBe("my.loggedOut"); // logged out, not "session expired"
  });
});

describe("Important 2: a stale join flag", () => {
  const PREVIEW = { organization_name: "Other Org", expires_at: "2026-11-12T03:00:00Z" };

  it("never joins an invitation the user did not tap Join on", async () => {
    testAuth();
    sessionStorage.setItem(INVITE_KEY, "tok-new");
    sessionStorage.setItem("saiflow.invite-join", "tok-old");
    const api = mockApi({
      "GET /api/v1/invitations/preview": () => json(200, PREVIEW),
      "POST /api/v1/invitations/accept": () => json(200, { tenant_id: 9 }),
    });
    signedIn();
    renderWithProviders(<InvitePage />);
    expect(await screen.findByText("You are invited to join Other Org")).toBeInTheDocument();
    await new Promise((r) => setTimeout(r, 50));
    expect(api.count("POST /api/v1/invitations/accept")).toBe(0);
  });

  it("an old bare flag does not auto-join either", async () => {
    testAuth();
    sessionStorage.setItem(INVITE_KEY, "tok-x");
    sessionStorage.setItem("saiflow.invite-join", "1");
    const api = mockApi({
      "GET /api/v1/invitations/preview": () => json(200, PREVIEW),
      "POST /api/v1/invitations/accept": () => json(200, { tenant_id: 9 }),
    });
    signedIn();
    renderWithProviders(<InvitePage />);
    await screen.findByText("You are invited to join Other Org");
    await new Promise((r) => setTimeout(r, 50));
    expect(api.count("POST /api/v1/invitations/accept")).toBe(0);
  });
});

describe("Important 3: a share that fails keeps the link", () => {
  const BASE = "/api/v1/organizations/5";
  function api() {
    return mockApi({
      [`GET ${BASE}`]: () =>
        json(200, {
          tenant_id: 5, name: "Siam Tools", contact_phone: "081", address: null, status: "active",
          verification_status: "none", member_count: 1, created_at: "2026-11-01T03:00:00Z",
          member_limit: 5, seats_used: 1,
        }),
      [`GET ${BASE}/members`]: () => json(200, []),
      [`GET ${BASE}/invitations`]: () => json(200, []),
      [`POST ${BASE}/invitations`]: () =>
        json(201, { id: 31, token: "tok-31", created_at: "x", expires_at: "2026-11-12T03:00:00Z" }),
    });
  }
  function asOwner() {
    signedIn(USER, [PERSONAL, { ...ORG, is_owner: true, role: null, permissions: [] }]);
    useTenantChoice.getState().choose(5);
  }

  it("shows the link when the clipboard is not available, without claiming it was copied", async () => {
    api();
    testAuth(fakeLiff({ loggedIn: true, share: false }));
    vi.stubGlobal("navigator", { ...navigator, clipboard: undefined });
    asOwner();
    renderWithProviders(<OrgPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Invite member" }));
    expect(await screen.findByText(/\?invite=tok-31/)).toBeInTheDocument();
    expect(screen.queryByText("Invitation link copied.")).toBeNull();
    vi.unstubAllGlobals();
  });

  it("keeps the link with Share again when the LINE share is cancelled", async () => {
    api();
    const liff = testAuth(fakeLiff({ loggedIn: true, share: true }));
    liff.shareTargetPicker.mockResolvedValueOnce(undefined);
    asOwner();
    renderWithProviders(<OrgPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Invite member" }));
    expect(await screen.findByText(/\?invite=tok-31/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Share again" }));
    await waitFor(() => expect(liff.shareTargetPicker).toHaveBeenCalledTimes(2));
  });
});
