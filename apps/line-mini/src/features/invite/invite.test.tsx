import { screen, waitFor } from "@testing-library/react";
import userEventLib from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { Shell } from "../../App";
import { useLanguage } from "../../stores/language";
import { useSession } from "../../stores/session";
import { testAuth } from "../../test/auth";
import { fakeLiff } from "../../test/fakeLiff";
import { GUEST, ORG, PERSONAL, signedIn, UNREGISTERED, USER } from "../../test/fixtures";
import { json, mockApi } from "../../test/mockApi";
import { renderWithProviders } from "../../test/render";
import { LoginSheet } from "../auth/LoginSheet";
import { RegisterDialog } from "../auth/RegisterDialog";
import { useTenantChoice } from "../tenants/useCurrentTenant";
import { INVITE_KEY, InvitePage } from "./InvitePage";

const userEvent = userEventLib.setup({ pointerEventsCheck: 0 });
const PREVIEW = { organization_name: "Siam Tools", expires_at: "2026-11-12T03:00:00Z" };

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useLanguage.getState().setLang("en");
  useTenantChoice.getState().choose(null);
  testAuth();
});

describe("invitations (FR-SYS-052)", () => {
  it("a registered user sees the organization and joins it (052-01)", async () => {
    sessionStorage.setItem(INVITE_KEY, "tok-1");
    const api = mockApi({
      "GET /api/v1/invitations/preview": () => json(200, PREVIEW),
      "POST /api/v1/invitations/accept": () => json(200, { tenant_id: 5 }),
      "GET /api/v1/me": () => json(200, USER),
      "GET /api/v1/me/tenants": () => json(200, [PERSONAL, ORG]),
    });
    signedIn();
    renderWithProviders(<InvitePage />);
    expect(await screen.findByText("You are invited to join Siam Tools")).toBeInTheDocument();
    expect(new URL(api.calls[0]!.url).searchParams.get("token")).toBe("tok-1");
    await userEvent.click(screen.getByRole("button", { name: "Join" }));
    await waitFor(() => expect(useTenantChoice.getState().id).toBe(5));
    expect(await api.bodies("POST /api/v1/invitations/accept")).toEqual([{ token: "tok-1" }]);
    expect(sessionStorage.getItem(INVITE_KEY)).toBeNull();
  });

  it("a guest logs in, registers, and joins without reopening the link (052-02)", async () => {
    sessionStorage.setItem(INVITE_KEY, "tok-2");
    testAuth(fakeLiff({ loggedIn: true }));
    const api = mockApi({
      "GET /api/v1/invitations/preview": () => json(200, PREVIEW),
      "POST /api/v1/auth/line": () => {
        api.set("GET /api/v1/me", () => json(200, UNREGISTERED));
        return json(200, UNREGISTERED);
      },
      "GET /api/v1/me": () => json(200, GUEST),
      "GET /api/v1/me/tenants": () => json(200, [PERSONAL]),
      "POST /api/v1/me/email-code": () => json(204, null),
      "POST /api/v1/me/registration": () => {
        api.set("GET /api/v1/me", () => json(200, USER));
        return json(200, USER);
      },
      "POST /api/v1/invitations/accept": () => {
        api.set("GET /api/v1/me/tenants", () => json(200, [PERSONAL, ORG]));
        return json(200, { tenant_id: 5 });
      },
    });
    signedIn(GUEST, []);
    renderWithProviders(
      <>
        <InvitePage />
        <LoginSheet />
        <RegisterDialog />
      </>,
    );
    await userEvent.click(await screen.findByRole("button", { name: "Join" }));
    await userEvent.click(await screen.findByRole("button", { name: "Log in with LINE" }));
    await waitFor(() => expect(useSession.getState().registerOpen).toBe(true));
    await userEvent.click(await screen.findByRole("button", { name: "Send code" }));
    await userEvent.type(screen.getByLabelText("Verification code"), "123456");
    await userEvent.type(screen.getByLabelText("Password"), "abcd1234");
    await userEvent.type(screen.getByLabelText("Confirm password"), "abcd1234");
    await userEvent.click(screen.getByRole("button", { name: "Register" }));
    await waitFor(() => expect(api.count("POST /api/v1/invitations/accept")).toBe(1));
    await waitFor(() => expect(useTenantChoice.getState().id).toBe(5));
  });

  it("an invalid invitation says so and offers home (052-03)", async () => {
    sessionStorage.setItem(INVITE_KEY, "old");
    mockApi({ "GET /api/v1/invitations/preview": () => json(410, { code: "invitation_gone" }) });
    signedIn();
    renderWithProviders(<InvitePage />);
    expect(await screen.findByText("This invitation is no longer valid.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to home" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Join" })).toBeNull();
  });

  it("a full organization says so on join (052-03)", async () => {
    sessionStorage.setItem(INVITE_KEY, "tok-3");
    mockApi({
      "GET /api/v1/invitations/preview": () => json(200, PREVIEW),
      "POST /api/v1/invitations/accept": () => json(409, { code: "member_limit_reached" }),
    });
    signedIn();
    renderWithProviders(<InvitePage />);
    await userEvent.click(await screen.findByRole("button", { name: "Join" }));
    expect(await screen.findByText("The organization has reached its member limit.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back to home" })).toBeInTheDocument();
  });

  it("joins once on a double tap and never keeps the token in localStorage", async () => {
    sessionStorage.setItem(INVITE_KEY, "tok-4");
    let release!: () => void;
    const api = mockApi({
      "GET /api/v1/invitations/preview": () => json(200, PREVIEW),
      "POST /api/v1/invitations/accept": () =>
        new Promise<Response>((r) => (release = () => r(json(200, { tenant_id: 5 })))),
      "GET /api/v1/me": () => json(200, USER),
      "GET /api/v1/me/tenants": () => json(200, [PERSONAL, ORG]),
    });
    signedIn();
    renderWithProviders(<InvitePage />);
    const join = await screen.findByRole("button", { name: "Join" });
    await userEvent.click(join);
    await userEvent.click(join);
    release();
    await waitFor(() => expect(useTenantChoice.getState().id).toBe(5));
    expect(api.count("POST /api/v1/invitations/accept")).toBe(1);
    expect(Object.values({ ...localStorage })).not.toContain("tok-4");
  });

  it("boot keeps ?invite= for this visit and opens the invitation", async () => {
    mockApi({
      "GET /api/v1/me": () => json(200, USER),
      "GET /api/v1/me/tenants": () => json(200, [PERSONAL]),
      "GET /api/v1/billing/usage": () => json(404, { code: "not_found" }),
      "GET /api/v1/invitations/preview": () => json(200, PREVIEW),
    });
    renderWithProviders(<Shell liff={fakeLiff()} search="?invite=tok-5" liffTimeoutMs={50} />);
    expect(await screen.findByText("You are invited to join Siam Tools")).toBeInTheDocument();
    expect(sessionStorage.getItem(INVITE_KEY)).toBe("tok-5");
    expect(localStorage.getItem(INVITE_KEY)).toBeNull();
  });
});
