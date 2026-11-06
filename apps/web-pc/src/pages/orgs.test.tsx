import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLanguage } from "../stores/language";
import { useTenantChoice } from "../tenants/useCurrentTenant";
import { en, renderAt, signedIn, userEvent } from "../test/app";
import { ORG, PERSONAL, USER, type UsableTenant } from "../test/fixtures";
import { json } from "../test/mockApi";

const T0 = "2026-11-01T03:00:00Z";
const OWNER_ORG: UsableTenant = { ...ORG, is_owner: true, role: null, permissions: [] };
const MEMBER_ORG = ORG; // role Member: no member_manage, no role_manage

function view(extra: Record<string, unknown> = {}) {
  return {
    tenant_id: 5, name: "Siam Tools", contact_phone: "0812345678", address: "Bangkok", status: "active",
    verification_status: "none", member_count: 2, created_at: T0, member_limit: 2, seats_used: 2, ...extra,
  };
}
const member = (user_id: number, name: string, extra: Record<string, unknown> = {}) => ({
  user_id, display_name: name, is_owner: false, role: { id: 10, name: "Default" }, joined_at: T0, ...extra,
});
const ROLES = [
  { id: 10, name: "Default", permissions: ["upload_ocr", "verify_own", "export"], is_default: true },
  { id: 12, name: "Reviewer", permissions: ["review_l1", "data_browse"], is_default: false },
];

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useLanguage.getState().setLang("en");
  localStorage.setItem("saiflow.pc.tenant.7", "5");
  useTenantChoice.getState().reset();
});

/** A backend for organization 5 with mutable state. */
function orgBackend({ tenant = OWNER_ORG, org = view(), members = [member(7, "Somchai", { is_owner: true, role: null }), member(8, "Malee")] } = {}) {
  const state = { org, members: [...members], invitations: [] as { id: number; created_at: string; expires_at: string }[], roles: [...ROLES], tenants: [PERSONAL, tenant] };
  const api = signedIn(
    {
      "GET /api/v1/me/tenants": () => json(200, state.tenants),
      "GET /api/v1/billing/usage": () => json(200, { plan: null, active: false, month: { month: "2026-11-01", quota: 0, used: 0, remaining: 0 }, free: { remaining: 0, expires_at: null, paused: false } }),
      "GET /api/v1/organizations/5": () => json(200, state.org),
      "GET /api/v1/organizations/5/members": () => json(200, state.members),
      "GET /api/v1/organizations/5/invitations": () => json(200, state.invitations),
      "GET /api/v1/organizations/5/roles": () => json(200, state.roles),
      "GET /api/v1/organizations/5/verification": () => json(200, { status: "none", legal_name: null, tax_id: null, registered_address: null, reject_reason: null }),
      "POST /api/v1/organizations/5/invitations": () => {
        const inv = { id: 31, created_at: T0, expires_at: "2026-11-08T03:00:00Z" };
        state.invitations.push(inv);
        return json(201, { ...inv, token: "tok-31" });
      },
      "DELETE /api/v1/organizations/5/invitations/31": () => {
        state.invitations = [];
        return json(204, null);
      },
    },
    { me: USER, tenants: state.tenants },
  );
  return { api, state };
}

async function confirmIn(container: HTMLElement | Document, button: string | RegExp) {
  const scope = container instanceof Document ? screen : within(container);
  await userEvent.click(scope.getByRole("button", { name: button }));
  await userEvent.click(await screen.findByRole("button", { name: en("common.confirm") }));
}

describe("organization application (FR-SYS-097)", () => {
  function applyBackend(apps: unknown[] = []) {
    const list = [...apps];
    return signedIn({
      "GET /api/v1/billing/usage": () => json(200, {}),
      "GET /api/v1/me/organization-applications": () => json(200, list),
      "POST /api/v1/organization-applications": async (r) => {
        const body = (await r.json()) as { name: string; contact_phone: string };
        list.unshift({ id: 1, ...body, address: null, status: "pending", reject_reason: null, tenant_id: null, created_at: T0, decided_at: null });
        return json(201, list[0]);
      },
    });
  }

  it("a double click on Submit sends one application (104-01)", async () => {
    let release!: () => void;
    const api = applyBackend();
    api.set("POST /api/v1/organization-applications", async () => {
      await new Promise<void>((done) => (release = done));
      return json(201, {});
    });
    renderAt("/org/apply");
    await userEvent.type(await screen.findByLabelText(en("org.name")), "Siam Tools");
    await userEvent.type(screen.getByLabelText(en("org.phone")), "0812345678");
    const submit = screen.getByRole("button", { name: en("org.submitApplication") });
    await userEvent.click(submit);
    await userEvent.click(submit);
    release();
    await waitFor(() => expect(api.count("POST /api/v1/organization-applications")).toBe(1));
  });

  it("lists the pending application and hides the form (097-01)", async () => {
    applyBackend();
    renderAt("/org/apply");
    await userEvent.type(await screen.findByLabelText(en("org.name")), "Siam Tools");
    await userEvent.type(screen.getByLabelText(en("org.phone")), "0812345678");
    await userEvent.click(screen.getByRole("button", { name: en("org.submitApplication") }));
    expect(await screen.findByText(en("org.submitted"))).toBeInTheDocument();
    expect(await screen.findByText(en("app.pending"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: en("org.submitApplication") })).not.toBeInTheDocument();
  });

  it("an empty name or phone shows required and posts nothing (097-02)", async () => {
    const api = applyBackend();
    renderAt("/org/apply");
    await userEvent.type(await screen.findByLabelText(en("org.name")), "Siam Tools");
    await userEvent.click(screen.getByRole("button", { name: en("org.submitApplication") }));
    expect(await screen.findByText(en("field.required"))).toBeInTheDocument();
    expect(api.count("POST /api/v1/organization-applications")).toBe(0);
  });

  it("a rejected application shows the reason and the form again (097-03)", async () => {
    applyBackend([{ id: 1, name: "Siam Tools", contact_phone: "0", address: null, status: "rejected", reject_reason: "Phone unreachable", tenant_id: null, created_at: T0, decided_at: T0 }]);
    renderAt("/org/apply");
    expect(await screen.findByText(en("app.reason", { reason: "Phone unreachable" }))).toBeInTheDocument();
    expect(screen.getByText(en("app.rejected"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en("org.submitApplication") })).toBeInTheDocument();
  });
});

describe("organization page (FR-SYS-098)", () => {
  it("shows profile, members and 2 / 2 (098-01)", async () => {
    orgBackend();
    renderAt("/org");
    expect(await screen.findByText(en("org.seats", { used: 2, limit: 2 }))).toBeInTheDocument();
    const profile = screen.getByTestId("org-profile");
    expect(within(profile).getByText("Siam Tools")).toBeInTheDocument();
    expect(within(profile).getByText("0812345678")).toBeInTheDocument();
    expect(within(profile).getByText(en("verify.none"))).toBeInTheDocument();
    const members = screen.getByTestId("members");
    expect(within(members).getByText("Malee")).toBeInTheDocument();
    expect(within(members).getByText(en("member.owner"))).toBeInTheDocument();
  });

  it("invite shows the link, Copy and a QR code; the invite is listed and revocable (098-02)", async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, "clipboard", { value: { writeText }, configurable: true });
    const { api } = orgBackend({ org: view({ seats_used: 1, member_count: 1 }) });
    renderAt("/org");
    await userEvent.click(await screen.findByRole("button", { name: en("org.invite") }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText("https://liff.line.me/test-liff?invite=tok-31")).toBeInTheDocument();
    expect(within(dialog).getByTestId("invite-qr")).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: en("invite.copy") }));
    expect(writeText).toHaveBeenCalledWith("https://liff.line.me/test-liff?invite=tok-31");
    expect(await within(dialog).findByText(en("invite.copied"))).toBeInTheDocument();
    await userEvent.click(within(dialog).getAllByRole("button", { name: en("common.close") }).at(-1)!);
    const list = await screen.findByTestId("invitations");
    expect(await within(list).findByText(en("invite.expires", { date: "2026-11-08" }))).toBeInTheDocument();
    await confirmIn(list, en("invite.revoke"));
    await waitFor(() => expect(api.count("DELETE /api/v1/organizations/5/invitations/31")).toBe(1));
  });

  it("a clipboard that refuses keeps the link visible with a hint (Review Focus 5)", async () => {
    Object.defineProperty(navigator, "clipboard", { value: { writeText: () => Promise.reject(new Error("denied")) }, configurable: true });
    orgBackend({ org: view({ seats_used: 1 }) });
    renderAt("/org");
    await userEvent.click(await screen.findByRole("button", { name: en("org.invite") }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: en("invite.copy") }));
    expect(await within(dialog).findByText(en("invite.copyFailed"))).toBeInTheDocument();
    expect(within(dialog).getByText("https://liff.line.me/test-liff?invite=tok-31")).toBeInTheDocument();
  });

  it("at the limit Invite is disabled with the reason (098-03)", async () => {
    orgBackend();
    renderAt("/org");
    expect(await screen.findByRole("button", { name: en("org.invite") })).toBeDisabled();
    expect(screen.getByText(en("err.member_limit_reached"))).toBeInTheDocument();
  });

  it("removes M after confirming and sets N to Reviewer (098-04, 104-02)", async () => {
    const { api, state } = orgBackend({
      members: [member(7, "Somchai", { is_owner: true, role: null }), member(8, "Malee"), member(9, "Niran")],
    });
    api.set("DELETE /api/v1/organizations/5/members/8", async () => {
      state.members = state.members.filter((m) => m.user_id !== 8);
      return json(204, null);
    });
    api.set("PUT /api/v1/organizations/5/members/9/role", async () => {
      state.members = state.members.map((m) => (m.user_id === 9 ? { ...m, role: { id: 12, name: "Reviewer" } } : m));
      return json(200, {});
    });
    renderAt("/org");
    const members = await screen.findByTestId("members");
    const malee = within(members).getByText("Malee").closest("tr")!;
    await userEvent.click(within(malee).getByRole("button", { name: en("member.remove") }));
    const ok = await screen.findByRole("button", { name: en("common.confirm") });
    await userEvent.dblClick(ok);
    await waitFor(() => expect(within(members).queryByText("Malee")).not.toBeInTheDocument());
    expect(api.count("DELETE /api/v1/organizations/5/members/8")).toBe(1);
    const niran = within(members).getByText("Niran").closest("tr")!;
    await userEvent.click(within(niran).getByRole("combobox", { name: en("member.changeRole") }));
    await userEvent.click(await screen.findByTitle("Reviewer"));
    await waitFor(() => expect(within(niran).getByTitle("Reviewer")).toHaveClass("ant-select-selection-item"));
    expect(await api.bodies("PUT /api/v1/organizations/5/members/9/role")).toEqual([{ role_id: 12 }]);
  });

  it("a member without member management sees no Invite and no Remove (096-04)", async () => {
    orgBackend({ tenant: MEMBER_ORG });
    renderAt("/org");
    await screen.findByTestId("members");
    expect(screen.queryByRole("button", { name: en("org.invite") })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: en("member.remove") })).not.toBeInTheDocument();
  });

  it("a backend field error on the profile shows under the phone (104-03)", async () => {
    const { api } = orgBackend();
    api.set("PATCH /api/v1/organizations/5", () => json(400, { code: "validation_error", fields: ["contact_phone"] }));
    renderAt("/org");
    await userEvent.click(await screen.findByRole("button", { name: en("common.edit") }));
    await userEvent.click(screen.getByRole("button", { name: en("common.save") }));
    expect(await screen.findByText(en("field.contact_phone"))).toBeInTheDocument();
    expect(screen.getByLabelText(en("org.name"))).toHaveValue("Siam Tools");
  });

  it("the organization answering 404 falls back to personal with a notice (Review Focus 4)", async () => {
    const { api, state } = orgBackend();
    api.set("GET /api/v1/organizations/5", () => {
      state.tenants = [PERSONAL];
      return json(404, { code: "not_found" });
    });
    renderAt("/org");
    expect(await screen.findByText(en("tenant.gone"))).toBeInTheDocument();
    expect(await screen.findByText(en("org.none"))).toBeInTheDocument();
    expect(localStorage.getItem("saiflow.pc.tenant.7")).toBeNull();
  });
});

describe("owner transfer and leaving (FR-SYS-100)", () => {
  it("transfers to V after confirming; U then sees Leave (100-01)", async () => {
    const { api, state } = orgBackend();
    api.set("POST /api/v1/organizations/5/owner-transfer", () => {
      state.members = [member(7, "Somchai"), member(8, "Malee", { is_owner: true, role: null })];
      state.tenants = [PERSONAL, { ...ORG, is_owner: false, role: { id: 10, name: "Default" } }];
      return json(204, null);
    });
    renderAt("/org");
    await userEvent.click(await screen.findByRole("combobox", { name: en("owner.pick") }));
    await userEvent.click(await screen.findByTitle("Malee"));
    await confirmIn(document, en("owner.transfer"));
    const members = screen.getByTestId("members");
    const malee = (await within(members).findByText("Malee")).closest("tr")!;
    expect(await within(malee).findByText(en("member.owner"))).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: en("org.leave") })).toBeInTheDocument();
    expect(await api.bodies("POST /api/v1/organizations/5/owner-transfer")).toEqual([{ user_id: 8 }]);
  });

  it("V leaves after confirming: personal tenant, no Siam Tools in the switcher (100-02)", async () => {
    const { api, state } = orgBackend({ tenant: MEMBER_ORG });
    api.set("POST /api/v1/organizations/5/leave", () => {
      state.tenants = [PERSONAL];
      return json(204, null);
    });
    renderAt("/org");
    await screen.findByRole("button", { name: en("org.leave") });
    await confirmIn(document, en("org.leave"));
    await waitFor(() => expect(localStorage.getItem("saiflow.pc.tenant.7")).toBeNull());
    await userEvent.click(await screen.findByRole("button", { name: en("tenant.switch") }));
    await waitFor(() => expect(screen.queryByRole("menuitem", { name: "Siam Tools" })).not.toBeInTheDocument());
  });
});

describe("enterprise verification (FR-SYS-101)", () => {
  it("submits and shows under review without the form (101-01)", async () => {
    const { api } = orgBackend();
    let status = "none";
    api.set("GET /api/v1/organizations/5/verification", () => json(200, { status, legal_name: null, tax_id: null, registered_address: null, reject_reason: null }));
    api.set("POST /api/v1/organizations/5/verification", () => {
      status = "pending";
      return json(201, { status });
    });
    renderAt("/org");
    const card = await screen.findByTestId("verification");
    await userEvent.type(await within(card).findByLabelText(en("verify.legalName")), "Siam Tools Co., Ltd.");
    await userEvent.type(within(card).getByLabelText(en("verify.taxId")), "0105551234567");
    await userEvent.type(within(card).getByLabelText(en("verify.address")), "Bangkok");
    await userEvent.click(within(card).getByRole("button", { name: en("common.submit") }));
    expect(await within(card).findByText(en("app.pending"))).toBeInTheDocument();
    expect(within(card).queryByRole("button", { name: en("common.submit") })).not.toBeInTheDocument();
  });

  it("rejected: the reason and the form again (101-02)", async () => {
    const { api } = orgBackend();
    api.set("GET /api/v1/organizations/5/verification", () => json(200, { status: "rejected", legal_name: "X", tax_id: "1", registered_address: "Y", reject_reason: "Wrong tax ID" }));
    renderAt("/org");
    const card = await screen.findByTestId("verification");
    expect(await within(card).findByText(en("app.reason", { reason: "Wrong tax ID" }))).toBeInTheDocument();
    expect(within(card).getByRole("button", { name: en("common.submit") })).toBeInTheDocument();
  });
});

describe("roles (FR-SYS-099)", () => {
  it("creates Reviewer with level-1 review and data browse (099-01)", async () => {
    const { api, state } = orgBackend();
    state.roles = [ROLES[0]!];
    api.set("POST /api/v1/organizations/5/roles", async (r) => {
      const body = (await r.json()) as { name: string; permissions: string[] };
      state.roles.push({ id: 12, ...body, is_default: false });
      return json(201, state.roles.at(-1));
    });
    renderAt("/roles");
    await userEvent.click(await screen.findByRole("button", { name: en("roles.new") }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(en("roles.name")), "Reviewer");
    await userEvent.click(within(dialog).getByRole("checkbox", { name: en("perm.review_l1") }));
    await userEvent.click(within(dialog).getByRole("checkbox", { name: en("perm.data_browse") }));
    await userEvent.click(within(dialog).getByRole("button", { name: en("common.save") }));
    const table = await screen.findByTestId("roles");
    const row = (await within(table).findByText("Reviewer")).closest("tr")!;
    expect(within(row).getByText(`${en("perm.review_l1")}, ${en("perm.data_browse")}`)).toBeInTheDocument();
  });

  it("the default role has no Delete; deleting Reviewer says 1 member moves (099-02)", async () => {
    const { api, state } = orgBackend({
      members: [member(7, "Somchai", { is_owner: true, role: null }), member(8, "Malee", { role: { id: 12, name: "Reviewer" } })],
    });
    api.set("DELETE /api/v1/organizations/5/roles/12", () => {
      state.roles = [ROLES[0]!];
      return json(204, null);
    });
    renderAt("/roles");
    const table = await screen.findByTestId("roles");
    const def = (await within(table).findByText(/^Default/)).closest("tr")!;
    expect(within(def).queryByRole("button", { name: en("common.delete") })).not.toBeInTheDocument();
    expect(within(def).getByRole("button", { name: en("common.edit") })).toBeInTheDocument();
    const reviewer = within(table).getByText("Reviewer").closest("tr")!;
    await userEvent.click(within(reviewer).getByRole("button", { name: en("common.delete") }));
    expect(await screen.findByText(en("roles.deleteMovesOne"))).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: en("common.confirm") }));
    await waitFor(() => expect(within(table).queryByText("Reviewer")).not.toBeInTheDocument());
  });
});
