// Ported from apps/line-mini/src/features/billing/money.ts (web-pc-account plan: copied, not shared).
import type { T } from "../i18n";

/** A THB price from the catalog ("5990.00") for display (A12): thousands separators, the
 * decimals only when they are not zero; no price means "Contact us" (D6). */
export function formatTHB(value: string | null, t: T): string {
  if (value === null) return t("plans.contactUs");
  const [whole = "0", cents = "00"] = value.split(".");
  const grouped = Number(whole).toLocaleString("en-US");
  // web-pc shows the baht sign (A6): "฿5,990".
  return /^0*$/.test(cents) ? `฿${grouped}` : `฿${grouped}.${cents.padEnd(2, "0")}`;
}
