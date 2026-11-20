import type { components } from "@saiflow/api-client";

import { api, call } from "./api";

type Schemas = components["schemas"];
export type Plan = Schemas["PlanOut"];
export type OcrSettings = Schemas["OcrSettingsOut"];
export type OcrChanges = Partial<Omit<OcrSettings, "keys">>;
export type PlanChanges = {
  monthly_quota?: number | string;
  member_limit?: number | string | null;
  monthly_price?: string | null;
  yearly_price?: string | null;
};

export const catalogKeys = {
  plans: ["plans"] as const,
  setting: (path: SettingPath) => ["settings", path] as const,
  ocr: ["ocr-settings"] as const,
};

export const SETTING_PATHS = [
  "free-quota-personal",
  "free-quota-organization",
  "org-member-limit-unpaid",
] as const;
export type SettingPath = (typeof SETTING_PATHS)[number];

export const catalog = {
  plans: () => call(api.GET("/api/v1/admin/plans")),
  updatePlan: (code: string, body: PlanChanges) =>
    call(api.PATCH("/api/v1/admin/plans/{code}", { params: { path: { code } }, body: body as never })),
  getSetting: (path: SettingPath) => call(api.GET(`/api/v1/admin/settings/${path}`)),
  setSetting: (path: SettingPath, value: number | string) =>
    call(api.PUT(`/api/v1/admin/settings/${path}`, { body: { value } as never })),
  ocr: () => call(api.GET("/api/v1/admin/ocr-settings")),
  updateOcr: (body: OcrChanges) => call(api.PATCH("/api/v1/admin/ocr-settings", { body })),
};

/** A whole number typed in a box, or the text itself so the backend names the field. */
export function asInt(text: string): number | string {
  return /^-?\d+$/.test(text.trim()) ? Number(text.trim()) : text;
}

/** A price as the backend shows it ("1290.00") → "฿1,290.00"; none → null. */
export function formatPrice(price: string | null): string | null {
  if (price === null) return null;
  const n = Number(price);
  return `฿${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** "1290.00" → "1290" for editing; keeps real decimals. */
export function priceInput(price: string | null): string {
  return price === null ? "" : price.replace(/\.00$/, "");
}
