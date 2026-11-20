import { screen, waitFor, within } from "@testing-library/react";
import userEventLib from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { useLanguage } from "../../stores/language";
import { useSession } from "../../stores/session";
import { testAuth } from "../../test/auth";
import { fakeLiff } from "../../test/fakeLiff";
import { ORG, PERSONAL, signedIn, USER } from "../../test/fixtures";
import { json, mockApi, type MockApi } from "../../test/mockApi";
import { renderWithProviders } from "../../test/render";
import { useTenantChoice } from "../tenants/useCurrentTenant";
import { ApplyOrgPage } from "./ApplyOrgPage";
import { OrgPage } from "./OrgPage";
import { RolesPage } from "./RolesPage";
import { VerificationPage } from "./VerificationPage";

const userEvent = userEventLib.setup({ pointerEventsCheck: 0 });
const OWNER_ORG = { ...ORG, is_owner: true, role: null, permissions: [] };
const BASE = `/api/v1/organizations/${ORG.tenant_id}`;

const ORG_VIEW = {
  tenant_id: 5,
  name: "Siam Tools",
  contact_phone: "081 234 5678",
  address: "Bangkok",
  status: "active",
  verification_status: "none",
  member_count: 2,
  created_at: "2026-11-01T03:00:00Z",
  member_limit: 2,
  seats_used: 2,
};
const MEMBERS = [
  { user_id: 7, display_name: "Somchai", is_owner: true, role: null, joined_at: "2026-11-01T03:00:00Z" },
  {
    user_id: 8,
    display_name: "Malee",
    is_owner: false,
    role: { id: 11, name: "Member" },
    joined_at: "2026-11-02T03:00:00Z",
  },
];
const ROLES = [
  { id: 11, name: "Member", is_default: true, permissions: ["export", "upload_ocr", "verify_own"] },
  { id: 12, name: "Reviewer", is_default: false, permissions: ["review_l1"] },
];

function orgApi(over: Record<string, (r: Request) => Response | Promise<Response>> = {}): MockApi {
  return mockApi({
    [`GET ${BASE}`]: () => json(200, ORG_VIEW),
    [`GET ${BASE}/members`]: () => json(200, MEMBERS),
    [`GET ${BASE}/invitations`]: () => json(200, []),
    [`GET ${BASE}/roles`]: () => json(200, ROLES),
    "GET /api/v1/me": () => json(200, USER),
    "GET /api/v1/me/tenants": () => json(200, [PERSONAL, OWNER_ORG]),
    ...over,
  });
}

function asOwner() {
  signedIn(USER, [PERSONAL, OWNER_ORG]);
  useTenantChoice.getState().choose(5);
}
function asMember(permissions: string[] = ORG.permissions) {
  signedIn({ ...USER, user_id: 8 }, [PERSONAL, { ...ORG, permissions }]);
  useTenantChoice.getState().choose(5);
}

beforeEach(() => {
  localStorage.clear();
  useLanguage.getState().setLang("en");
  testAuth();
});

describe("organization application (FR-SYS-047)", () => {
  it("submits and lists it as under review (047-01)", async () => {
    let apps: unknown[] = [];
    const api = mockApi({
      "GET /api/v1/me/organization-applications": () => json(200, apps),
      "POST /api/v1/organization-applications": () => {
        apps = [
          {
            id: 1, tenant_id: null, name: "Siam Tools", contact_phone: "081", address: null,
            status: "pending", reject_reason: null, created_at: "2026-11-05T03:00:00Z", decided_at: null,
          },
        ];
        return json(201, apps[0]);
      },
    });
    signedIn();
    renderWithProviders(<ApplyOrgPage />);
    await userEvent.type(await screen.findByLabelText("Organization name"), "Siam Tools");
    await userEvent.type(screen.getByLabelText("Contact phone"), "081");
    await userEvent.click(screen.getByRole("button", { name: "Submit application" }));
    expect(await screen.findByText("Under review")).toBeInTheDocument();
    expect(await api.bodies("POST /api/v1/organization-applications")).toEqual([
      { name: "Siam Tools", contact_phone: "081", address: "" },
    ]);
    expect(screen.queryByRole("button", { name: "Submit application" })).toBeNull();
  });

  it("requires name and phone without calling the server (047-02)", async () => {
    const api = mockApi({ "GET /api/v1/me/organization-applications": () => json(200, []) });
    signedIn();
    renderWithProviders(<ApplyOrgPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Submit application" }));
    expect(screen.getAllByText("This field is required.")).toHaveLength(2);
    expect(api.count("POST /api/v1/organization-applications")).toBe(0);
  });

  it("shows a rejection with its reason and allows a new one (047-03)", async () => {
    mockApi({
      "GET /api/v1/me/organization-applications": () =>
        json(200, [
          {
            id: 1, tenant_id: null, name: "Siam Tools", contact_phone: "081", address: null,
            status: "rejected", reject_reason: "Phone unreachable", created_at: "2026-11-05T03:00:00Z",
            decided_at: "2026-11-05T05:00:00Z",
          },
        ]),
    });
    signedIn();
    renderWithProviders(<ApplyOrgPage />);
    expect(await screen.findByText("Rejected")).toBeInTheDocument();
    expect(screen.getByText(/Phone unreachable/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Submit application" })).toBeInTheDocument();
  });

  it("refreshes the tenants when an application was approved (047-04)", async () => {
    const api = mockApi({
      "GET /api/v1/me/organization-applications": () =>
        json(200, [
          {
            id: 1, tenant_id: 5, name: "Siam Tools", contact_phone: "081", address: null,
            status: "approved", reject_reason: null, created_at: "2026-11-05T03:00:00Z",
            decided_at: "2026-11-05T05:00:00Z",
          },
        ]),
      "GET /api/v1/me": () => json(200, USER),
      "GET /api/v1/me/tenants": () => json(200, [PERSONAL, OWNER_ORG]),
    });
    signedIn(USER, [PERSONAL]);
    renderWithProviders(<ApplyOrgPage />);
    expect(await screen.findByText("Approved")).toBeInTheDocument();
    await waitFor(() => expect(useSession.getState().tenants).toHaveLength(2));
    expect(api.count("GET /api/v1/me/tenants")).toBe(1);
  });
});

describe("organization page (FR-SYS-048)", () => {
  it("shows the profile, members and seats (048-01)", async () => {
    orgApi();
    asOwner();
    renderWithProviders(<OrgPage />);
    expect(await screen.findByText("Siam Tools")).toBeInTheDocument();
    expect(screen.getByText("Members 2 / 2")).toBeInTheDocument();
    expect(screen.getByText("Malee")).toBeInTheDocument();
  });

  it("at the limit, Invite is disabled with the reason (048-03)", async () => {
    orgApi();
    asOwner();
    renderWithProviders(<OrgPage />);
    expect(await screen.findByRole("button", { name: "Invite member" })).toBeDisabled();
    expect(screen.getByText("The organization has reached its member limit.")).toBeInTheDocument();
  });

  it("creates a link, shares it in LINE, lists and revokes it (048-02)", async () => {
    let open: unknown[] = [];
    const api = orgApi({
      [`GET ${BASE}`]: () => json(200, { ...ORG_VIEW, seats_used: 1, member_limit: 5 }),
      [`GET ${BASE}/invitations`]: () => json(200, open),
      [`POST ${BASE}/invitations`]: () => {
        open = [{ id: 31, created_at: "2026-11-05T03:00:00Z", expires_at: "2026-11-12T03:00:00Z" }];
        return json(201, { id: 31, token: "tok-31", created_at: "x", expires_at: "2026-11-12T03:00:00Z" });
      },
      [`DELETE ${BASE}/invitations/31`]: () => {
        open = [];
        return json(204, null);
      },
    });
    const liff = testAuth(fakeLiff({ loggedIn: true, share: true }));
    asOwner();
    renderWithProviders(<OrgPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Invite member" }));
    await waitFor(() => expect(liff.shareTargetPicker).toHaveBeenCalledTimes(1));
    expect(String(liff.shareTargetPicker.mock.calls[0]![0][0].text)).toContain("?invite=tok-31");
    expect(await screen.findByText(/2026-11-12/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Revoke" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(api.count(`DELETE ${BASE}/invitations/31`)).toBe(1));
  });

  it("removes a member and changes a role (048-04)", async () => {
    const api = orgApi({
      [`DELETE ${BASE}/members/8`]: () => json(204, null),
      [`PUT ${BASE}/members/8/role`]: () => json(200, { user_id: 8, role_id: 12 }),
    });
    asOwner();
    renderWithProviders(<OrgPage />);
    const row = (await screen.findByText("Malee")).closest("[data-member]") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "Change role" }));
    await userEvent.click(await screen.findByRole("option", { name: "Reviewer" }));
    await waitFor(() => expect(api.count(`PUT ${BASE}/members/8/role`)).toBe(1));
    expect(await api.bodies(`PUT ${BASE}/members/8/role`)).toEqual([{ role_id: 12 }]);
    await userEvent.click(within(row).getByRole("button", { name: "Remove" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(api.count(`DELETE ${BASE}/members/8`)).toBe(1));
  });

  it("a member without member_manage sees no invite, remove or edit (046-03)", async () => {
    orgApi();
    asMember();
    renderWithProviders(<OrgPage />);
    await screen.findByText("Malee");
    expect(screen.queryByRole("button", { name: "Invite member" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Remove" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Edit" })).toBeNull();
  });

  it("never offers role or remove actions on the owner or on oneself", async () => {
    orgApi();
    asMember(["member_manage", "role_manage"]);
    renderWithProviders(<OrgPage />);
    const owner = (await screen.findByText("Somchai")).closest("[data-member]") as HTMLElement;
    const self = screen.getByText("Malee").closest("[data-member]") as HTMLElement;
    expect(within(owner).queryByRole("button")).toBeNull();
    expect(within(self).queryByRole("button")).toBeNull();
  });
});

describe("roles (FR-SYS-049)", () => {
  it("creates a role with two points (049-01)", async () => {
    const api = orgApi({
      [`POST ${BASE}/roles`]: () =>
        json(201, { id: 13, name: "Checker", is_default: false, permissions: ["data_browse", "review_l1"] }),
    });
    asOwner();
    renderWithProviders(<RolesPage />);
    await userEvent.click(await screen.findByRole("button", { name: "New role" }));
    await userEvent.type(screen.getByLabelText("Role name"), "Checker");
    await userEvent.click(screen.getByRole("checkbox", { name: "Level-1 review" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Browse data" }));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(api.count(`POST ${BASE}/roles`)).toBe(1));
    const [body] = (await api.bodies(`POST ${BASE}/roles`)) as { name: string; permissions: string[] }[];
    expect(body!.name).toBe("Checker");
    expect([...body!.permissions].sort()).toEqual(["data_browse", "review_l1"]);
  });

  it("the default role has no delete (049-02)", async () => {
    orgApi();
    asOwner();
    renderWithProviders(<RolesPage />);
    const row = (await screen.findByText(/^Member/)).closest("[data-role]") as HTMLElement;
    expect(within(row).queryByRole("button", { name: "Delete" })).toBeNull();
    expect(within(row).getByRole("button", { name: "Edit" })).toBeInTheDocument();
  });

  it("deleting a role in use says how many members move (049-03)", async () => {
    const api = orgApi({
      [`GET ${BASE}/members`]: () =>
        json(200, [MEMBERS[0], { ...MEMBERS[1], role: { id: 12, name: "Reviewer" } }]),
      [`DELETE ${BASE}/roles/12`]: () => json(204, null),
    });
    asOwner();
    renderWithProviders(<RolesPage />);
    const row = (await screen.findByText("Reviewer")).closest("[data-role]") as HTMLElement;
    await userEvent.click(within(row).getByRole("button", { name: "Delete" }));
    expect(await screen.findByText("1 member will move to the default role.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(api.count(`DELETE ${BASE}/roles/12`)).toBe(1));
  });

  it("a role manager cannot edit their own role", async () => {
    orgApi();
    signedIn({ ...USER, user_id: 8 }, [PERSONAL, { ...ORG, role: { id: 12, name: "Reviewer" }, permissions: ["role_manage"] }]);
    useTenantChoice.getState().choose(5);
    renderWithProviders(<RolesPage />);
    const row = (await screen.findByText("Reviewer")).closest("[data-role]") as HTMLElement;
    expect(within(row).queryByRole("button", { name: "Edit" })).toBeNull();
  });
});

describe("owner transfer and leaving (FR-SYS-050)", () => {
  it("transfers the owner after confirmation (050-01)", async () => {
    const api = orgApi({ [`POST ${BASE}/owner-transfer`]: () => json(200, { owner_user_id: 8 }) });
    asOwner();
    renderWithProviders(<OrgPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Transfer owner" }));
    await userEvent.click(await screen.findByRole("option", { name: "Malee" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(api.count(`POST ${BASE}/owner-transfer`)).toBe(1));
    expect(await api.bodies(`POST ${BASE}/owner-transfer`)).toEqual([{ user_id: 8 }]);
  });

  it("the owner sees no Leave", async () => {
    orgApi();
    asOwner();
    renderWithProviders(<OrgPage />);
    await screen.findByText("Malee");
    expect(screen.queryByRole("button", { name: "Leave organization" })).toBeNull();
  });

  it("a member leaves and returns to the personal tenant (050-02)", async () => {
    const api = orgApi({
      [`POST ${BASE}/leave`]: () => json(204, null),
      "GET /api/v1/me/tenants": () => json(200, [PERSONAL]),
    });
    asMember();
    renderWithProviders(<OrgPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Leave organization" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(api.count(`POST ${BASE}/leave`)).toBe(1));
    await waitFor(() => expect(useTenantChoice.getState().id).toBeNull());
    expect(useSession.getState().tenants).toEqual([PERSONAL]);
  });
});

describe("enterprise verification (FR-SYS-051)", () => {
  it("submits and then shows under review without the form (051-01)", async () => {
    let status: Record<string, string | null> = {
      status: "none",
      legal_name: null,
      tax_id: null,
      registered_address: null,
      reject_reason: null,
    };
    const api = orgApi({
      [`GET ${BASE}/verification`]: () => json(200, status),
      [`POST ${BASE}/verification`]: () => {
        status = { ...status, status: "pending", legal_name: "Siam Tools Co., Ltd." };
        return json(201, status);
      },
    });
    asOwner();
    renderWithProviders(<VerificationPage />);
    await userEvent.type(await screen.findByLabelText("Legal name"), "Siam Tools Co., Ltd.");
    await userEvent.type(screen.getByLabelText("Tax ID"), "0105561234567");
    await userEvent.type(screen.getByLabelText("Registered address"), "Bangkok");
    await userEvent.click(screen.getByRole("button", { name: "Submit" }));
    expect(await screen.findByText("Under review")).toBeInTheDocument();
    expect(screen.queryByLabelText("Legal name")).toBeNull();
    expect(api.count(`POST ${BASE}/verification`)).toBe(1);
  });

  it("shows the rejection reason and allows a new submission (051-02)", async () => {
    orgApi({
      [`GET ${BASE}/verification`]: () =>
        json(200, {
          status: "rejected", legal_name: "X", tax_id: "1", registered_address: "Y",
          reject_reason: "Tax ID does not match",
        }),
    });
    asOwner();
    renderWithProviders(<VerificationPage />);
    expect(await screen.findByText("Rejected")).toBeInTheDocument();
    expect(screen.getByText(/Tax ID does not match/)).toBeInTheDocument();
    expect(screen.getByLabelText("Legal name")).toBeInTheDocument();
  });
});


describe("one request per confirmed action (minor-fixes-ui)", () => {
  it("double click sends one request", async () => {
    const api = orgApi({
      [`POST ${BASE}/leave`]: () => json(204, null),
      "GET /api/v1/me/tenants": () => json(200, [PERSONAL]),
    });
    asMember();
    renderWithProviders(<OrgPage />);
    const leave = await screen.findByRole("button", { name: "Leave organization" });
    await userEvent.click(leave);
    await userEvent.click(leave);
    const confirms = await screen.findAllByRole("button", { name: "Confirm" });
    expect(confirms).toHaveLength(1);
    await userEvent.click(confirms[0]!);
    await waitFor(() => expect(api.count(`POST ${BASE}/leave`)).toBe(1));
  });

  it("failed action can be retried", async () => {
    let n = 0;
    const api = orgApi({
      [`POST ${BASE}/leave`]: () => (++n === 1 ? json(500, { code: "internal" }) : json(204, null)),
      "GET /api/v1/me/tenants": () => json(200, [PERSONAL]),
    });
    asMember();
    renderWithProviders(<OrgPage />);
    await userEvent.click(await screen.findByRole("button", { name: "Leave organization" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(api.count(`POST ${BASE}/leave`)).toBe(1));
    await userEvent.click(await screen.findByRole("button", { name: "Leave organization" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(api.count(`POST ${BASE}/leave`)).toBe(2));
  });
});
