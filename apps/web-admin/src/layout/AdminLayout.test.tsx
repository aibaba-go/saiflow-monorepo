import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useLanguage } from "../stores/language";
import { json } from "../test/mockApi";
import { renderAt, signedIn, userEvent, zh } from "../test/admin";
import { AIBABA_URL, MENU, pageTitle } from "./AdminLayout";

beforeEach(() => {
  localStorage.clear();
  useLanguage.getState().setLang("zh");
});

describe("branded admin shell (FR-SYS-135, FR-SYS-138)", () => {
  it("shows the sidebar navigation with every menu item in order and the page in the topbar (AC-FR-SYS-135-02)", async () => {
    signedIn({ "GET /api/v1/admin/audit-log": () => json(200, { items: [], next_before: null }) });
    renderAt("/audit-log");
    expect(await screen.findByRole("heading", { name: zh("nav.auditLog") })).toBeInTheDocument();

    const sidebar = screen.getByRole("complementary", { name: zh("layout.sidebar") });
    expect(within(sidebar).getByText(zh("layout.brand"))).toBeInTheDocument();
    expect(within(sidebar).getByText(zh("layout.subtitle"))).toBeInTheDocument();
    const nav = within(sidebar).getByRole("navigation", { name: zh("layout.mainNav") });
    const links = within(nav).getAllByRole("link");
    expect(links.map((a) => a.textContent)).toEqual(MENU.map((m) => zh(m.label)));
    expect(links.map((a) => a.getAttribute("href"))).toEqual(MENU.map((m) => m.path));

    const current = within(nav).getByRole("link", { name: zh("nav.auditLog") }).closest("li");
    expect(current).toHaveClass("ant-menu-item-selected");
    expect(nav.querySelectorAll(".ant-menu-item-selected")).toHaveLength(1);

    const breadcrumb = screen.getByRole("navigation", { name: zh("layout.breadcrumb") });
    expect(within(breadcrumb).getByText(zh("nav.auditLog"))).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("banner")).toContainElement(screen.getByText("ops"));
  });

  it("shows the page eyebrow and description in the heading", async () => {
    signedIn({ "GET /api/v1/admin/audit-log": () => json(200, { items: [], next_before: null }) });
    renderAt("/audit-log");
    const page = await screen.findByTestId("page-auditLog");
    expect(within(page).getByText(zh("page.auditLog.eyebrow"))).toBeInTheDocument();
    expect(within(page).getByText(zh("page.auditLog.description"))).toBeInTheDocument();
  });

  it("opens the company link safely in a new window", async () => {
    signedIn({ "GET /api/v1/admin/audit-log": () => json(200, { items: [], next_before: null }) });
    renderAt("/audit-log");
    const link = await screen.findByRole("link", { name: zh("layout.companyLink") });
    expect(link).toHaveAttribute("href", AIBABA_URL);
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("logs out from the topbar back to the login page", async () => {
    let signedInNow = true;
    const api = signedIn({
      "GET /api/v1/admin/me": () =>
        signedInNow ? json(200, { admin_id: 1, username: "ops" }) : json(401, { code: "unauthenticated" }),
      "GET /api/v1/admin/audit-log": () => json(200, { items: [], next_before: null }),
      "POST /api/v1/admin/auth/logout": () => {
        signedInNow = false;
        return json(204, null);
      },
    });
    renderAt("/audit-log");
    const banner = await screen.findByRole("banner");
    await userEvent.click(within(banner).getByRole("button", { name: zh("nav.logout") }));
    expect(await screen.findByRole("button", { name: zh("login.submit") })).toBeInTheDocument();
    expect(api.count("POST /api/v1/admin/auth/logout")).toBe(1);
  });

  it("names the topbar page for menu pages and the pages reached from them", () => {
    expect(pageTitle("/")).toBe("nav.home");
    expect(pageTitle("/organizations/7")).toBe("nav.organizations");
    expect(pageTitle("/tenants/7/billing")).toBe("org.billing");
    expect(pageTitle("/password")).toBe("nav.changePassword");
    expect(pageTitle("/nowhere")).toBeNull();
  });
});
