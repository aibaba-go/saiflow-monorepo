import { screen, waitFor, within } from "@testing-library/react";
import userEventLib from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { translate } from "../../i18n";
import { useLanguage } from "../../stores/language";
import { GUEST, ORG, PERSONAL, signedIn, USER } from "../../test/fixtures";
import { json, mockApi } from "../../test/mockApi";
import { renderWithProviders } from "../../test/render";
import { useTenantChoice } from "../tenants/useCurrentTenant";
import { formatTHB } from "./money";
import type { Usage } from "../tenants/reportTab";
import { applicableAction, type CatalogPlan } from "./planRules";
import { PlansPage } from "./PlansPage";

const userEvent = userEventLib.setup({ pointerEventsCheck: 0 });
const t = (k: Parameters<typeof translate>[1]) => translate("en", k);

const CATALOG: CatalogPlan[] = [
  { code: "kinder", monthly_quota: 1000, member_limit: 1, tenant_kind: "personal", monthly_price: null, yearly_price: "888.00" },
  { code: "starter", monthly_quota: 5000, member_limit: 2, tenant_kind: "organization", monthly_price: "599.00", yearly_price: "5990.00" },
  { code: "intermediate", monthly_quota: 10000, member_limit: 5, tenant_kind: "organization", monthly_price: null, yearly_price: null },
  { code: "advance", monthly_quota: 100000, member_limit: null, tenant_kind: "organization", monthly_price: null, yearly_price: null },
];
const usage = (code: string | null, active: boolean): Usage => ({
  active,
  plan: code ? { code: code as NonNullable<Usage["plan"]>["code"], period: "month", starts_at: "2026-11-01T00:00:00Z", ends_at: "2026-12-01T00:00:00Z" } : null,
  month: { month: "2026-11-01", quota: 5000, used: 0, remaining: 5000 },
  free: { remaining: 0, expires_at: null, paused: false },
});
const OWNER_ORG = { ...ORG, is_owner: true, role: null, permissions: [] };

beforeEach(() => {
  localStorage.clear();
  useLanguage.getState().setLang("en");
  useTenantChoice.getState().choose(null);
});

describe("money (A12)", () => {
  it("formats THB prices", () => {
    expect(formatTHB("5990.00", t)).toBe("5,990");
    expect(formatTHB("599.50", t)).toBe("599.50");
    expect(formatTHB("100000.00", t)).toBe("100,000");
    expect(formatTHB(null, t)).toBe("Contact us");
  });
});

describe("plan rules (FR-SYS-053, PRD §4.9)", () => {
  const plan = (code: string) => CATALOG.find((p) => p.code === code)!;
  it("personal: Kinder only", () => {
    expect(applicableAction(plan("kinder"), "personal", usage("kinder", true), true)).toBe("renew");
    expect(applicableAction(plan("starter"), "personal", usage("kinder", true), true)).toBeNull();
    expect(applicableAction(plan("kinder"), "personal", usage("kinder", false), true)).toBe("apply");
  });
  it("organization on an active Intermediate: no lower tier (053-03)", () => {
    const u = usage("intermediate", true);
    expect(applicableAction(plan("kinder"), "organization", u, true)).toBeNull();
    expect(applicableAction(plan("starter"), "organization", u, true)).toBeNull();
    expect(applicableAction(plan("intermediate"), "organization", u, true)).toBe("renew");
    expect(applicableAction(plan("advance"), "organization", u, true)).toBe("apply");
  });
  it("organization expired or never subscribed: any tier from Starter", () => {
    for (const u of [usage("advance", false), usage(null, false)]) {
      expect(applicableAction(plan("kinder"), "organization", u, true)).toBeNull();
      expect(applicableAction(plan("starter"), "organization", u, true)).toBe("apply");
    }
  });
  it("guests and members without plan_apply: nothing", () => {
    expect(applicableAction(plan("kinder"), "guest", usage("kinder", true), true)).toBeNull();
    expect(applicableAction(plan("advance"), "organization", usage(null, false), false)).toBeNull();
  });
});

function plansApi(over: Record<string, (r: Request) => Response | Promise<Response>> = {}) {
  return mockApi({
    "GET /api/v1/billing/plans": () => json(200, CATALOG),
    "GET /api/v1/billing/usage": () => json(200, usage("starter", true)),
    "GET /api/v1/billing/applications": () => json(200, []),
    ...over,
  });
}

const card = (name: string) => screen.getByText(name).closest("[data-plan]") as HTMLElement;

describe("plans page (FR-SYS-053)", () => {
  it("links back to home, for guests too (there is no tab bar here)", async () => {
    plansApi();
    signedIn(GUEST, []);
    renderWithProviders(
      <Routes>
        <Route path="/plans" element={<PlansPage />} />
        <Route path="/" element={<div>home page</div>} />
      </Routes>,
      { route: "/plans" },
    );
    const back = await screen.findByRole("link", { name: "Back to home" });
    expect(back).toHaveAttribute("href", "/");
    await userEvent.click(back);
    expect(await screen.findByText("home page")).toBeInTheDocument();
  });

  it("shows prices or contact us (053-05)", async () => {
    plansApi();
    signedIn(USER, [PERSONAL, OWNER_ORG]);
    useTenantChoice.getState().choose(5);
    renderWithProviders(<PlansPage />);
    await screen.findByText("Advance");
    expect(within(card("Kinder")).getByText("888 / year")).toBeInTheDocument();
    expect(within(card("Starter")).getByText("599 / month")).toBeInTheDocument();
    expect(within(card("Starter")).getByText("5,990 / year")).toBeInTheDocument();
    expect(within(card("Intermediate")).getByText("Contact us")).toBeInTheDocument();
    expect(within(card("Advance")).getByText("Contact us")).toBeInTheDocument();
    expect(within(card("Starter")).getByText("Current plan")).toBeInTheDocument();
    // an organization owner cannot pick Kinder: the card says why instead of showing a button
    expect(within(card("Kinder")).getByText("Not available for this workspace")).toBeInTheDocument();
    expect(within(card("Kinder")).queryByRole("button")).toBeNull();
    expect(within(card("Starter")).getByRole("button", { name: "Renew" })).toBeInTheDocument();
  });

  it("applies with confirmation, then shows the pending banner (053-02)", async () => {
    let apps: unknown[] = [];
    const api = plansApi({
      "GET /api/v1/billing/applications": () => json(200, apps),
      "POST /api/v1/billing/applications": () => {
        apps = [
          {
            id: 1, tenant_id: 5, applicant_user_id: 7, plan_code: "intermediate", period: "month",
            note: null, status: "pending", reject_reason: null, created_at: "2026-11-05T03:00:00Z",
            decided_at: null, subscription_id: null,
          },
        ];
        return json(201, apps[0]);
      },
    });
    signedIn(USER, [PERSONAL, OWNER_ORG]);
    useTenantChoice.getState().choose(5);
    renderWithProviders(<PlansPage />);
    await screen.findByText("Intermediate");
    await userEvent.click(within(card("Intermediate")).getByRole("button", { name: "Apply" }));
    await userEvent.click(await screen.findByRole("option", { name: "Monthly" }));
    expect(await screen.findByText("Apply for Intermediate (monthly)?")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    expect(
      await screen.findByText("Your application has been received. We will contact you soon."),
    ).toBeInTheDocument();
    expect(await api.bodies("POST /api/v1/billing/applications")).toEqual([
      { plan_code: "intermediate", period: "month" },
    ]);
    // the received notice is modal (the page behind is hidden from assistive tech): close it
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    expect(await screen.findByText(/Intermediate \(monthly\) · in review/)).toBeInTheDocument();
    expect(within(card("Advance")).getByRole("button", { name: "Apply" })).toBeDisabled();
  });

  it("a guest sees the offline note and no buttons; a member without plan_apply too (053-04)", async () => {
    plansApi({ "GET /api/v1/billing/usage": () => json(200, usage("kinder", true)) });
    signedIn(GUEST, []);
    const { unmount } = renderWithProviders(<PlansPage />);
    expect(await screen.findByText(t("plans.guestNote"))).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Apply|Renew/ })).toBeNull();
    unmount();
    plansApi();
    signedIn(USER, [PERSONAL, ORG]);
    useTenantChoice.getState().choose(5);
    renderWithProviders(<PlansPage />);
    await screen.findByText("Advance");
    expect(screen.queryByRole("button", { name: /Apply|Renew/ })).toBeNull();
  });

  it("sends one application on a double tap", async () => {
    let release!: () => void;
    const api = plansApi({
      "POST /api/v1/billing/applications": () =>
        new Promise<Response>((r) => (release = () => r(json(201, {})))),
    });
    signedIn(USER, [PERSONAL, OWNER_ORG]);
    useTenantChoice.getState().choose(5);
    renderWithProviders(<PlansPage />);
    await screen.findByText("Advance");
    await userEvent.click(within(card("Advance")).getByRole("button", { name: "Apply" }));
    await userEvent.click(await screen.findByRole("option", { name: "Yearly" }));
    const confirm = await screen.findByRole("button", { name: "Confirm" });
    await userEvent.click(confirm);
    await userEvent.click(confirm).catch(() => {});
    release();
    await waitFor(() => expect(api.count("POST /api/v1/billing/applications")).toBe(1));
  });
});
