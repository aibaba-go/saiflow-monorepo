import type { components } from "@saiflow/api-client";

import { api, call } from "./api";

type Schemas = components["schemas"];
export type Organization = Schemas["OrganizationOut"];
export type Subscription = Schemas["SubscriptionOut"];
export type Reservation = Schemas["ReservationOut"];

export interface SubscriptionBody {
  plan_code: string;
  period: string;
  starts_at?: string;
  ends_at?: string;
}

const tenant = (id: number) => ({ path: { tenant_id: id } });

export const orgKeys = {
  all: ["organizations"] as const,
  one: (id: number) => ["organizations", id] as const,
  subscriptions: (id: number) => ["tenants", id, "subscriptions"] as const,
  reservations: (id: number) => ["tenants", id, "reservations"] as const,
};

export const organizations = {
  list: () => call(api.GET("/api/v1/admin/organizations")),
  get: (id: number) => call(api.GET("/api/v1/admin/organizations/{tenant_id}", { params: tenant(id) })),
  update: (id: number, body: { name: string; contact_phone: string; address: string }) =>
    call(api.PATCH("/api/v1/admin/organizations/{tenant_id}", { params: tenant(id), body })),
  setStatus: (id: number, status: "active" | "disabled") =>
    status === "disabled"
      ? call(api.POST("/api/v1/admin/organizations/{tenant_id}/disable", { params: tenant(id) }))
      : call(api.POST("/api/v1/admin/organizations/{tenant_id}/enable", { params: tenant(id) })),
  setVerified: (id: number, verified: boolean) =>
    call(api.PUT("/api/v1/admin/organizations/{tenant_id}/verification", { params: tenant(id), body: { verified } })),
  subscriptions: (id: number) =>
    call(api.GET("/api/v1/admin/tenants/{tenant_id}/subscriptions", { params: tenant(id) })),
  reservations: (id: number) =>
    call(api.GET("/api/v1/admin/tenants/{tenant_id}/reservations", { params: tenant(id) })),
  setSubscription: (id: number, body: SubscriptionBody) =>
    call(api.PUT("/api/v1/admin/tenants/{tenant_id}/subscription", { params: tenant(id), body })),
};

/** A positive integer route parameter, or null. */
export function idParam(value: string | undefined): number | null {
  return value && /^\d+$/.test(value) && Number(value) > 0 ? Number(value) : null;
}
