import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useTenantChoice } from "../tenants/useCurrentTenant";
import { useLanguage } from "../stores/language";
import { en, renderAt, signedIn, userEvent } from "../test/app";
import { ORG, PERSONAL, USER } from "../test/fixtures";
import { json } from "../test/mockApi";
import { translate } from "../i18n";

const USAGE = {
  plan: { code: "starter", period: "month", starts_at: "2026-11-01T03:00:00Z", ends_at: "2026-12-01T03:00:00Z" },
  active: true,
  month: { month: "2026-11-01", quota: 5000, used: 120, remaining: 4880 },
  free: { remaining: 40, expires_at: "2026-11-20T03:00:00Z", paused: false },
};
const PERSONAL_USAGE = {
  plan: { code: "kinder", period: "year", starts_at: "2026-01-01T00:00:00Z", ends_at: "2027-01-01T00:00:00Z" },
  active: true,
  month: { month: "2026-11-01", quota: 1000, used: 0, remaining: 1000 },
  free: { remaining: 100, expires_at: null, paused: false },
};
const usageFor = (r: Request) => json(200, r.headers.get("X-Tenant-Id") === "5" ? USAGE : PERSONAL_USAGE);

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useTenantChoice.getState().reset();
  useLanguage.getState().setLang("en");
});

async function openSwitcher() {
  await userEvent.click(await screen.findByRole("button", { name: en("tenant.switch") }));
}

describe("layout and home (FR-SYS-094)", () => {
  it("home shows the organization's plan, period, scans left and free quota (094-01)", async () => {
    localStorage.setItem("saiflow.pc.tenant.7", "5");
    useTenantChoice.getState().reset();
    signedIn({ "GET /api/v1/billing/usage": usageFor }, { tenants: [PERSONAL, ORG] });
    renderAt("/");
    const card = await screen.findByTestId("usage-card");
    expect(await within(card).findByText("Starter")).toBeInTheDocument();
    expect(within(card).getByText(en("usage.validUntil", { date: "2026-12-01" }))).toBeInTheDocument();
    expect(within(card).getByText("4,880 / 5,000")).toBeInTheDocument();
    expect(within(card).getByText(`${en("usage.free", { n: "40" })} · ${en("usage.freeExpires", { date: "2026-11-20" })}`)).toBeInTheDocument();
  });

  it("personal tenant: the org page asks to switch and the menu has no Roles (094-02)", async () => {
    signedIn({ "GET /api/v1/billing/usage": usageFor });
    renderAt("/org");
    expect(await screen.findByText(en("org.none"))).toBeInTheDocument();
    const menu = screen.getByRole("menu");
    expect(within(menu).queryByText(en("nav.roles"))).not.toBeInTheDocument();
    expect(within(menu).getByText(en("nav.org"))).toBeInTheDocument();
  });

  it("data browse is coming soon (094-03)", async () => {
    signedIn({ "GET /api/v1/billing/usage": usageFor });
    renderAt("/");
    await userEvent.click(await screen.findByRole("link", { name: en("nav.data") }));
    expect(await screen.findByText(en("common.comingSoon"))).toBeInTheDocument();
  });

  it("switching the language changes the menu at once and is kept (093-02)", async () => {
    signedIn({ "GET /api/v1/billing/usage": usageFor });
    renderAt("/");
    await screen.findByTestId("usage-card");
    await userEvent.click(screen.getByRole("combobox", { name: en("my.language") }));
    await userEvent.click(await screen.findByTitle("ไทย"));
    expect(await within(screen.getByRole("menu")).findByRole("link", { name: translate("th", "nav.plans") })).toBeInTheDocument();
    expect(localStorage.getItem("saiflow.pc.lang")).toBe("th");
  });
});

describe("tenant switching (FR-SYS-096)", () => {
  it("switching to Siam Tools sends its tenant id and is kept (096-01)", async () => {
    const api = signedIn({ "GET /api/v1/billing/usage": usageFor }, { tenants: [PERSONAL, ORG] });
    const first = renderAt("/");
    await screen.findByText("1,000 / 1,000");
    await openSwitcher();
    await userEvent.click(await screen.findByRole("menuitem", { name: "Siam Tools" }));
    expect(await screen.findByText("4,880 / 5,000")).toBeInTheDocument();
    expect(api.calls.at(-1)!.headers.get("X-Tenant-Id")).toBe("5");
    expect(localStorage.getItem("saiflow.pc.tenant.7")).toBe("5");
    first.unmount();
    useTenantChoice.getState().reset();
    renderAt("/");
    expect(await screen.findByText("4,880 / 5,000")).toBeInTheDocument();
  });

  it("opening the switcher re-reads the tenants: a new org appears; a failed read keeps the list (096-02)", async () => {
    const api = signedIn({ "GET /api/v1/billing/usage": usageFor }, { tenants: [PERSONAL] });
    renderAt("/");
    await screen.findByText("1,000 / 1,000");
    api.set("GET /api/v1/me/tenants", () => json(200, [PERSONAL, ORG]));
    await openSwitcher();
    expect(await screen.findByRole("menuitem", { name: "Siam Tools" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: en("tenant.switch") })); // close
    api.set("GET /api/v1/me/tenants", () => json(500, { code: "internal_error" }));
    await openSwitcher();
    await waitFor(() => expect(api.count("GET /api/v1/me/tenants")).toBe(3));
    expect(screen.getByRole("menuitem", { name: "Siam Tools" })).toBeInTheDocument();
  });

  it("a stored organization the user left falls back to personal with a notice (096-03)", async () => {
    localStorage.setItem("saiflow.pc.tenant.7", "5");
    useTenantChoice.getState().reset();
    signedIn({ "GET /api/v1/billing/usage": usageFor }, { tenants: [PERSONAL] });
    renderAt("/");
    expect(await screen.findByText(en("tenant.gone"))).toBeInTheDocument();
    expect(await screen.findByText("1,000 / 1,000")).toBeInTheDocument();
    expect(localStorage.getItem("saiflow.pc.tenant.7")).toBeNull();
  });
});

describe("an organization that disappears mid-session (Review Focus 4)", () => {
  it("the home page falls back to the personal tenant with a notice, not a raw error", async () => {
    localStorage.setItem("saiflow.pc.tenant.7", "5");
    useTenantChoice.getState().reset();
    let gone = false;
    const api = signedIn(
      { "GET /api/v1/billing/usage": (r) => (r.headers.get("X-Tenant-Id") === "5" && gone ? json(404, { code: "not_found" }) : usageFor(r)) },
      { tenants: [PERSONAL, ORG] },
    );
    renderAt("/");
    expect(await screen.findByText("4,880 / 5,000")).toBeInTheDocument();
    gone = true;
    api.set("GET /api/v1/me/tenants", () => json(200, [PERSONAL]));
    // Leave home and come back: the usage is fetched again and now answers 404.
    await userEvent.click(screen.getByRole("link", { name: en("nav.data") }));
    await userEvent.click(await screen.findByRole("link", { name: en("nav.home") }));
    expect(await screen.findByText(en("tenant.gone"))).toBeInTheDocument();
    expect(await screen.findByText("1,000 / 1,000")).toBeInTheDocument();
    expect(screen.queryByText(en("err.not_found"))).not.toBeInTheDocument();
  });
});

describe("profile (FR-SYS-095)", () => {
  it("saves nickname Somchai and a cleared phone; the header follows (095-01)", async () => {
    let me = { ...USER, display_name: "Som" };
    const api = signedIn(
      {
        "GET /api/v1/billing/usage": usageFor,
        "PATCH /api/v1/me": async (r) => {
          const body = (await r.json()) as { display_name: string; phone: string | null };
          me = { ...me, display_name: body.display_name, phone: body.phone || null };
          return json(200, me);
        },
      },
      { me },
    );
    renderAt("/profile");
    const name = await screen.findByLabelText(en("profile.nickname"));
    await userEvent.clear(name);
    await userEvent.type(name, "Somchai");
    await userEvent.clear(screen.getByLabelText(en("profile.phoneOptional")));
    await userEvent.click(screen.getByRole("button", { name: en("common.save") }));
    const summary = await screen.findByTestId("profile-summary");
    expect(await within(summary).findByText("Somchai")).toBeInTheDocument();
    expect(within(summary).getByText(en("common.notSet"))).toBeInTheDocument();
    expect(within(screen.getByRole("banner")).getByText("Somchai")).toBeInTheDocument();
    expect(await api.bodies("PATCH /api/v1/me")).toEqual([{ display_name: "Somchai", phone: null }]);
  });

  it("changes the email with a code; Send code counts down (095-02)", async () => {
    let me = USER;
    signedIn(
      {
        "GET /api/v1/billing/usage": usageFor,
        "POST /api/v1/me/email-code": () => json(204, null),
        "POST /api/v1/me/email": async () => {
          me = { ...me, email: "new@example.com" };
          return json(200, me);
        },
      },
      { me },
    );
    renderAt("/profile");
    await userEvent.click(await screen.findByRole("button", { name: en("profile.changeEmail") }));
    await userEvent.type(await screen.findByLabelText(en("profile.newEmail")), "new@example.com");
    await userEvent.click(screen.getByRole("button", { name: en("profile.sendCode") }));
    // jsdom never ends antd's loading-icon motion, so the name may keep a "loading" prefix.
    expect(await screen.findByRole("button", { name: /60s$/ })).toBeDisabled();
    await userEvent.type(screen.getByLabelText(en("profile.code")), "123456");
    await userEvent.click(screen.getByRole("button", { name: en("common.confirm") }));
    expect(await within(screen.getByTestId("profile-summary")).findByText("new@example.com")).toBeInTheDocument();
  });

  it("a bad phone shows under the phone input and keeps the values (095-03)", async () => {
    signedIn({
      "GET /api/v1/billing/usage": usageFor,
      "PATCH /api/v1/me": () => json(400, { code: "validation_error", fields: ["phone"] }),
    });
    renderAt("/profile");
    const phone = await screen.findByLabelText(en("profile.phoneOptional"));
    await userEvent.clear(phone);
    await userEvent.type(phone, "12ab");
    await userEvent.click(screen.getByRole("button", { name: en("common.save") }));
    expect(await screen.findByText(en("field.phone"))).toBeInTheDocument();
    expect(phone).toHaveValue("12ab");
  });
});
