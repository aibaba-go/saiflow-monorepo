import type { components } from "@saiflow/api-client";

import type { CurrentTenant } from "../../stores/session";

export type Usage = components["schemas"]["UsageOut"];

const REPORT_PLANS = new Set(["starter", "intermediate", "advance"]);

/** The Report tab (FR-SYS-056, D7): an organization with an active Starter or higher plan,
 * and a user who is the owner or holds report_view. */
export function showReportTab(tenant: CurrentTenant | null, usage: Usage | undefined): boolean {
  if (!tenant || tenant.kind !== "organization" || !usage?.active || !usage.plan) return false;
  if (!REPORT_PLANS.has(usage.plan.code)) return false;
  return tenant.is_owner || tenant.permissions.includes("report_view");
}
