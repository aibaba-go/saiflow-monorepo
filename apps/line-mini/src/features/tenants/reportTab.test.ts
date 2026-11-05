import { describe, expect, it } from "vitest";

import { showReportTab, type Usage } from "./reportTab";

const org = (over = {}) => ({
  tenant_id: 5,
  kind: "organization" as "organization" | "personal" | "guest",
  name: "Siam Tools",
  is_owner: false,
  role: { id: 1, name: "Member" },
  permissions: [] as string[],
  ...over,
});
const usage = (code: string | null, active = true): Usage => ({
  active,
  plan: code ? { code: code as NonNullable<Usage["plan"]>["code"], period: "month", starts_at: "2026-01-01T00:00:00Z", ends_at: "2026-02-01T00:00:00Z" } : null,
  month: { month: "2026-01-01", quota: 5000, used: 0, remaining: 5000 },
  free: { remaining: 0, expires_at: null, paused: false },
});

describe("showReportTab (FR-SYS-056, D7)", () => {
  it("personal tenant: no (056-01)", () => {
    expect(showReportTab(org({ kind: "personal", is_owner: true }), usage("kinder"))).toBe(false);
  });
  it("organization on an active Starter: owner yes, member with report_view yes (056-02)", () => {
    expect(showReportTab(org({ is_owner: true }), usage("starter"))).toBe(true);
    expect(showReportTab(org({ permissions: ["report_view"] }), usage("intermediate"))).toBe(true);
    expect(showReportTab(org({ is_owner: true }), usage("advance"))).toBe(true);
  });
  it("member without report_view, expired, or no plan: no (056-03)", () => {
    expect(showReportTab(org({ permissions: ["export"] }), usage("starter"))).toBe(false);
    expect(showReportTab(org({ is_owner: true }), usage("starter", false))).toBe(false);
    expect(showReportTab(org({ is_owner: true }), usage(null, false))).toBe(false);
  });
  it("guest or unknown usage: no (056-04)", () => {
    expect(showReportTab(org({ kind: "guest", is_owner: true }), usage("kinder"))).toBe(false);
    expect(showReportTab(org({ is_owner: true }), undefined)).toBe(false);
  });
});
