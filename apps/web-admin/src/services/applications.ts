import type { components } from "@saiflow/api-client";

import { api, call } from "./api";

type Schemas = components["schemas"];
export type OrgApplication = Schemas["AdminApplicationOut"];
export type VerificationApplication = Schemas["AdminVerificationOut"];
export type PlanApplication = Schemas["PlanApplicationOut"];

export type Status = "pending" | "approved" | "rejected";
export const STATUSES: Status[] = ["pending", "approved", "rejected"];

export function asStatus(value: string | null): Status {
  return STATUSES.includes(value as Status) ? (value as Status) : "pending";
}

export interface ApproveDates {
  starts_at?: string;
  ends_at?: string;
}

/** One application queue: list by status, approve, reject with a reason. */
export interface Queue<A> {
  kind: "organization" | "verification" | "plan";
  list(status: Status): Promise<A[]>;
  approve(id: number, dates?: ApproveDates): Promise<unknown>;
  reject(id: number, reason: string): Promise<unknown>;
}

export const queueKey = (kind: Queue<unknown>["kind"], status?: Status) =>
  status ? ["applications", kind, status] : ["applications", kind];

const path = (id: number) => ({ path: { application_id: id } });

export const organizationQueue: Queue<OrgApplication> = {
  kind: "organization",
  list: (status) =>
    call(api.GET("/api/v1/admin/organization-applications", { params: { query: { status } } })),
  approve: (id) =>
    call(api.POST("/api/v1/admin/organization-applications/{application_id}/approve", { params: path(id) })),
  reject: (id, reason) =>
    call(
      api.POST("/api/v1/admin/organization-applications/{application_id}/reject", {
        params: path(id),
        body: { reason },
      }),
    ),
};

export const verificationQueue: Queue<VerificationApplication> = {
  kind: "verification",
  list: (status) =>
    call(api.GET("/api/v1/admin/verification-applications", { params: { query: { status } } })),
  approve: (id) =>
    call(api.POST("/api/v1/admin/verification-applications/{application_id}/approve", { params: path(id) })),
  reject: (id, reason) =>
    call(
      api.POST("/api/v1/admin/verification-applications/{application_id}/reject", {
        params: path(id),
        body: { reason },
      }),
    ),
};

export const planQueue: Queue<PlanApplication> = {
  kind: "plan",
  list: (status) => call(api.GET("/api/v1/admin/plan-applications", { params: { query: { status } } })),
  approve: (id, dates = {}) =>
    call(
      api.POST("/api/v1/admin/plan-applications/{application_id}/approve", {
        params: path(id),
        body: dates,
      }),
    ),
  reject: (id, reason) =>
    call(
      api.POST("/api/v1/admin/plan-applications/{application_id}/reject", {
        params: path(id),
        body: { reason },
      }),
    ),
};
