// Ported from apps/line-mini/src/features/billing/planRules.ts (web-pc-account plan: copied, not shared).
import type { components } from "@saiflow/api-client";

type Usage = components["schemas"]["UsageOut"];

export type CatalogPlan = components["schemas"]["PlanOut"];

const RANK: Record<string, number> = { kinder: 0, starter: 1, intermediate: 2, advance: 3 };

/** What the current tenant may ask for on this plan (PRD §4.9, FR-SYS-102 via 053):
 * personal tenants only Kinder; organizations Starter or higher; while a plan is active,
 * the same tier is a renewal and lower tiers are not offered; guests and users without
 * plan_apply get nothing. */
export function applicableAction(
  plan: Pick<CatalogPlan, "code" | "tenant_kind">,
  tenantKind: string,
  usage: Usage | undefined,
  mayApply: boolean,
): "renew" | "apply" | null {
  if (!mayApply || tenantKind === "guest") return null;
  if (tenantKind === "personal" && plan.code !== "kinder") return null;
  if (tenantKind === "organization" && plan.tenant_kind !== "organization") return null;
  const current = usage?.active && usage.plan ? usage.plan.code : null;
  if (current === null) return "apply";
  const diff = RANK[plan.code]! - RANK[current]!;
  if (diff < 0) return null;
  return diff === 0 ? "renew" : "apply";
}
