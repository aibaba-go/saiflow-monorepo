import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { translate } from "../i18n";
import { useLanguage } from "../stores/language";
import { useTenantChoice } from "../tenants/useCurrentTenant";
import { en, renderAt, signedIn, userEvent } from "../test/app";
import { ORG, PERSONAL, type UsableTenant } from "../test/fixtures";
import { json } from "../test/mockApi";

const T0 = "2026-11-01T03:00:00Z";
const CATALOG = [
  { code: "kinder", monthly_quota: 1000, member_limit: 1, tenant_kind: "personal", monthly_price: null, yearly_price: "888.00" },
  { code: "starter", monthly_quota: 5000, member_limit: 2, tenant_kind: "organization", monthly_price: "599.00", yearly_price: "5990.00" },
  { code: "intermediate", monthly_quota: 10000, member_limit: 5, tenant_kind: "organization", monthly_price: null, yearly_price: null },
  { code: "advance", monthly_quota: 100000, member_limit: null, tenant_kind: "organization", monthly_price: null, yearly_price: null },
];
const INTERMEDIATE_USAGE = {
  plan: { code: "intermediate", period: "month", starts_at: T0, ends_at: "2026-12-01T03:00:00Z" },
  active: true,
  month: { month: "2026-11-01", quota: 10000, used: 0, remaining: 10000 },
  free: { remaining: 0, expires_at: null, paused: false },
};
const OWNER_ORG: UsableTenant = { ...ORG, is_owner: true, role: null, permissions: [] };

beforeEach(() => {
  localStorage.clear();
  useLanguage.getState().setLang("en");
  localStorage.setItem("saiflow.pc.tenant.7", "5");
  useTenantChoice.getState().reset();
});

function plansBackend(tenant: UsableTenant = OWNER_ORG) {
  const apps: unknown[] = [];
  return signedIn(
    {
      "GET /api/v1/billing/plans": () => json(200, CATALOG),
      "GET /api/v1/billing/usage": () => json(200, INTERMEDIATE_USAGE),
      "GET /api/v1/billing/applications": () => json(200, apps),
      "POST /api/v1/billing/applications": async (r) => {
        const body = (await r.json()) as { plan_code: string; period: string };
        apps.unshift({ id: 1, tenant_id: 5, applicant_user_id: 7, ...body, note: null, status: "pending", reject_reason: null, subscription_id: null, created_at: "2026-11-06T03:00:00Z" });
        return json(201, apps[0]);
      },
    },
    { tenants: [PERSONAL, tenant] },
  );
}
const card = (code: string) => screen.getByTestId(`plan-${code}`);

describe("plans (FR-SYS-102)", () => {
  it("shows the prices in baht and Contact us (102-01)", async () => {
    plansBackend();
    renderAt("/plans");
    await screen.findByTestId("plan-kinder");
    expect(within(card("kinder")).getByText(en("plans.perYear", { price: "฿888" }))).toBeInTheDocument();
    expect(within(card("starter")).getByText(en("plans.perMonth", { price: "฿599" }))).toBeInTheDocument();
    expect(within(card("starter")).getByText(en("plans.perYear", { price: "฿5,990" }))).toBeInTheDocument();
    expect(within(card("intermediate")).getByText(en("plans.contactUs"))).toBeInTheDocument();
    expect(within(card("advance")).getByText(en("plans.contactUs"))).toBeInTheDocument();
  });

  it("renews Intermediate monthly after confirming; the pending one blocks the others (102-02)", async () => {
    const api = plansBackend();
    renderAt("/plans");
    await screen.findByTestId("plan-kinder");
    expect(within(card("starter")).queryByRole("button")).not.toBeInTheDocument();
    expect(within(card("kinder")).queryByRole("button")).not.toBeInTheDocument();
    // a card without an action says so in the button's place; the current plan is highlighted
    expect(within(card("starter")).getByText(en("plans.unavailable"))).toBeInTheDocument();
    expect(card("intermediate")).toHaveClass("pc-plan--current");
    expect(card("advance")).not.toHaveClass("pc-plan--current");
    expect(within(card("intermediate")).getByText(en("plans.current"))).toBeInTheDocument();
    await userEvent.click(within(card("intermediate")).getByRole("button", { name: en("plans.renew") }));
    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByText(en("plans.confirmTitle", { plan: "Intermediate", period: en("plans.periodMonth") }))).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole("button", { name: en("common.confirm") }));
    expect(await screen.findByText(en("plans.received"))).toBeInTheDocument();
    expect(await screen.findByText(en("plans.pending", { plan: "Intermediate", period: en("plans.periodMonth"), date: "2026-11-06 10:00" }))).toBeInTheDocument();
    await waitFor(() => expect(within(card("advance")).getByRole("button", { name: en("plans.apply") })).toBeDisabled());
    expect(await api.bodies("POST /api/v1/billing/applications")).toEqual([{ plan_code: "intermediate", period: "month" }]);
  });

  it("a member without plan applications sees plans and usage but no buttons (102-03)", async () => {
    plansBackend(ORG);
    renderAt("/plans");
    await screen.findByTestId("plan-kinder");
    expect(screen.getByTestId("usage-card")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: en("plans.apply") })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: en("plans.renew") })).not.toBeInTheDocument();
  });
});

describe("notifications (FR-SYS-103)", () => {
  const reminder = (id: number, read = false) => ({
    id, type: "subscription_expiry", tenant_id: 5, read, created_at: T0,
    data: { stage: "d7", plan_code: "starter", ends_at: "2026-11-08T03:00:00Z" },
  });

  function notifBackend(items: ReturnType<typeof reminder>[]) {
    const list = items.map((n) => ({ ...n }));
    const page = () => ({ items: list, unread_count: list.filter((n) => !n.read).length, next_before: null });
    return signedIn(
      {
        "GET /api/v1/billing/usage": () => json(200, INTERMEDIATE_USAGE),
        "GET /api/v1/me/notifications": () => json(200, page()),
        "POST /api/v1/me/notifications/read": async (r) => {
          const body = (await r.json()) as { ids?: number[] };
          for (const n of list) if (!body.ids || body.ids.includes(n.id)) n.read = true;
          return json(200, { updated: 1, unread_count: page().unread_count });
        },
      },
      { tenants: [PERSONAL, OWNER_ORG] },
    );
  }

  it("shows 2 unread, marks one read, then all (103-01)", async () => {
    notifBackend([reminder(1), reminder(2)]);
    renderAt("/");
    const badge = await screen.findByTestId("unread-badge");
    expect(await within(badge).findByText("2")).toBeInTheDocument();
    await userEvent.click(within(badge).getByRole("button", { name: en("nav.notifications") }));
    const title = en("notif.subscription_expiry.dn", { n: 7 });
    const body = en("notif.subscription_expiry.body", { tenant: "Siam Tools", plan: "Starter", date: "2026-11-08 10:00" });
    expect(await screen.findAllByText(title)).toHaveLength(2);
    expect(screen.getAllByText(body)).toHaveLength(2);
    await userEvent.click(screen.getAllByRole("button", { name: en("notif.unreadItem", { title }) })[0]!);
    await waitFor(() => expect(within(badge).getByText("1")).toBeInTheDocument());
    await userEvent.click(screen.getByRole("button", { name: en("notif.markAll") }));
    await waitFor(() => expect(within(badge).queryByText("1")).not.toBeInTheDocument());
    expect(screen.queryByRole("button", { name: en("notif.unreadItem", { title }) })).not.toBeInTheDocument();
  });

  it("switching to Chinese shows the notification in Chinese (103-02)", async () => {
    notifBackend([{ ...reminder(3), type: "usage", data: { stage: "low", remaining: 900, quota: 5000 } } as never]);
    renderAt("/notifications");
    expect(await screen.findByText(en("notif.usage.low"))).toBeInTheDocument();
    useLanguage.getState().setLang("zh");
    expect(await screen.findByText(translate("zh", "notif.usage.low"))).toBeInTheDocument();
    expect(screen.getByText(translate("zh", "notif.usage.body", { tenant: "Siam Tools", remaining: "900", quota: "5,000" }))).toBeInTheDocument();
  });
});
