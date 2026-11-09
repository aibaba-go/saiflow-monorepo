import { screen, within } from "@testing-library/react";
import userEventLib from "@testing-library/user-event";
import { beforeEach, describe, expect, it } from "vitest";

import { Shell } from "../App";
import { useLanguage } from "../stores/language";
import { useSession } from "../stores/session";
import { fakeLiff } from "../test/fakeLiff";
import { json, mockApi } from "../test/mockApi";
import { renderWithProviders } from "../test/render";

const userEvent = userEventLib.setup({ pointerEventsCheck: 0 });
const USER = {
  kind: "user", user_id: 7, tenant_id: 70, display_name: "Somchai", email: "s@example.com",
  email_suggestion: null, phone: null, avatar_url: null, registered: true,
};
const GUEST = { ...USER, kind: "guest", user_id: null, tenant_id: 90, display_name: null, email: null, registered: false };
const USAGE = {
  active: true,
  plan: { code: "starter", period: "month", starts_at: "2026-11-01T00:00:00Z", ends_at: "2026-12-10T03:00:00Z" },
  month: { month: "2026-11-01", quota: 5000, used: 120, remaining: 4880 },
  free: { remaining: 40, expires_at: "2026-12-01T03:00:00Z", paused: false },
};

function boot(me: unknown, route = "/") {
  mockApi({
    "GET /api/v1/me": () => json(200, me),
    "GET /api/v1/me/tenants": () =>
      json(200, [{ tenant_id: 70, kind: "personal", name: null, is_owner: true, role: null, permissions: [] }]),
    "GET /api/v1/billing/usage": () => json(200, USAGE),
    "GET /api/v1/me/notifications": () => json(200, { items: [], next_cursor: null, unread_count: 3 }),
  });
  return renderWithProviders(<Shell liff={fakeLiff()} search="" liffTimeoutMs={50} />, { route });
}

beforeEach(() => {
  localStorage.clear();
  useSession.getState().reset();
  useLanguage.getState().setLang("en");
});

describe("shell (FR-SYS-056)", () => {
  it("personal tenant: Home, History, My — no Report (056-01)", async () => {
    boot(USER);
    const nav = await screen.findByRole("navigation");
    expect(within(nav).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Home", "History", "My"]);
  });

  it("History shows the history list, not coming soon (056-05)", async () => {
    boot(USER, "/history");
    expect(await screen.findByText("All")).toBeInTheDocument();
    expect(screen.queryByText("Coming soon")).toBeNull();
  });

  it("home shows the usage in main's quota banner (053-01)", async () => {
    boot(USER);
    expect(await screen.findByText("Starter · 4,880 / 5,000 pages left this month")).toBeInTheDocument();
    expect(screen.getByText(/Valid until 2026-12-10/)).toBeInTheDocument();
    expect(screen.getAllByText(/40/).length).toBeGreaterThan(0); // free scans
  });

  it("guest My: identity, language, login; no notifications entry (054-04)", async () => {
    boot(GUEST, "/my");
    expect(await screen.findByText("Guest")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log in / Register" })).toBeInTheDocument();
    expect(screen.getByText("Language")).toBeInTheDocument();
    expect(screen.queryByText("Notifications")).not.toBeInTheDocument();
  });

  it("user My: profile hero, workspace card and settings rows with their values (FR-SYS-138)", async () => {
    boot(USER, "/my");
    expect(await screen.findByRole("heading", { name: "Somchai" })).toBeInTheDocument();
    expect(screen.getByText("s@example.com")).toBeInTheDocument();
    const workspace = screen.getByRole("button", { name: /Personal account/ });
    expect(await within(workspace).findByText("Current workspace · Starter")).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Account & services" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Plans Starter" })).toBeInTheDocument();
    expect(await screen.findByRole("button", { name: "Notifications 3 unread" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Profile" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Create organization" })).toBeInTheDocument();
    expect(screen.getByRole("group", { name: "Language" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
    await userEvent.click(workspace);
    expect(await screen.findByRole("listbox", { name: "Switch account" })).toBeInTheDocument();
  });

  it("switching to Chinese re-renders the tabs at once (004-02)", async () => {
    boot(USER, "/my");
    await userEvent.click(await screen.findByRole("button", { name: "中文" }));
    const nav = screen.getByRole("navigation");
    expect(within(nav).getAllByRole("tab").map((t) => t.textContent)).toEqual(["首页", "历史", "我的"]);
    expect(localStorage.getItem("saiflow.lang")).toBe("zh");
  });

  it("a LIFF fragment (#access_token=...) is not a page: back to Home with the tabs", async () => {
    boot(USER, "/access_token=abc&context_token=def&feature_token=x");
    const nav = await screen.findByRole("navigation");
    expect(within(nav).getAllByRole("tab").map((t) => t.textContent)).toEqual(["Home", "History", "My"]);
    expect(within(nav).getByRole("tab", { name: "Home" })).toHaveAttribute("aria-selected", "true");
  });
});
