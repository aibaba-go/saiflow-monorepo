import type { components } from "@saiflow/api-client";

import { isMessageKey, type MessageKey, type T } from "../../i18n";
import { formatBangkokDateTime, formatCount } from "../../utils/format";
import { planName } from "../billing/UsageCard";

export type NotificationItem = components["schemas"]["NotificationOut"];

/** type → stage → [title key, body key]. Days before a date use "dn" with {n}. */
const KEYS: Record<string, Record<string, [string, string]>> = {
  subscription_expiry: {
    d7: ["notif.subscription_expiry.dn", "notif.subscription_expiry.body"],
    d3: ["notif.subscription_expiry.dn", "notif.subscription_expiry.body"],
    d1: ["notif.subscription_expiry.d1", "notif.subscription_expiry.body"],
    d0: ["notif.subscription_expiry.d0", "notif.subscription_expiry.body"],
    after: ["notif.subscription_expiry.after", "notif.subscription_expiry.afterBody"],
  },
  usage: {
    low: ["notif.usage.low", "notif.usage.body"],
    month_end: ["notif.usage.month_end", "notif.usage.monthEndBody"],
  },
  free_quota_expiry: {
    d7: ["notif.free_quota_expiry.dn", "notif.free_quota_expiry.body"],
    d3: ["notif.free_quota_expiry.dn", "notif.free_quota_expiry.body"],
    d1: ["notif.free_quota_expiry.d1", "notif.free_quota_expiry.body"],
    d0: ["notif.free_quota_expiry.d0", "notif.free_quota_expiry.body"],
  },
};
const DAYS: Record<string, number> = { d7: 7, d3: 3, d1: 1, d0: 0 };

/** Title and body of a notification in the current language (A11): the backend keeps only
 * the type, the stage and the data. Unknown types or stages get a generic text. */
export function renderNotification(
  n: NotificationItem,
  t: T,
  tenantName: string,
): { title: string; body: string } {
  const d = n.data as Record<string, unknown>;
  const stage = String(d.stage ?? "");
  const keys = KEYS[n.type]?.[stage];
  if (!keys || !isMessageKey(keys[0]) || !isMessageKey(keys[1])) {
    return { title: t("notif.generic"), body: tenantName };
  }
  const iso = d.ends_at ?? d.expires_at;
  const vars = {
    tenant: tenantName,
    plan: typeof d.plan_code === "string" ? planName(d.plan_code, t) : "",
    n: DAYS[stage] ?? 0,
    date: typeof iso === "string" ? formatBangkokDateTime(iso) : "",
    remaining: formatCount(typeof d.remaining === "number" ? d.remaining : 0),
    quota: formatCount(typeof d.quota === "number" ? d.quota : 0),
  };
  return { title: t(keys[0] as MessageKey, vars), body: t(keys[1] as MessageKey, vars) };
}
