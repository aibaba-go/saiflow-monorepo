// Calls of the review pages (FR-SYS-123-125), as in apps/line-mini/src/features/reviews/api.ts
// (copied, not shared, like the rest of web-pc).
import type { components } from "@saiflow/api-client";
import { useQuery } from "@tanstack/react-query";

import { api, call } from "../services/api";
import type { CurrentTenant } from "../tenants/useCurrentTenant";
import { useTenant } from "../tenants/useTenant";

export type ReviewItem = components["schemas"]["ReviewItemOut"];
export type ReviewDetail = components["schemas"]["ReviewDetailOut"];
export type ReviewSettings = components["schemas"]["ReviewSettingsOut"];
export type ReviewRecord = components["schemas"]["ReviewRecordOut"];
export type ChangeEntry = components["schemas"]["ChangeOut"];
export type ResultOut = components["schemas"]["ResultOut"];
export type Level = 1 | 2;
export type Decision = "approve" | "return";

export const PAGE_SIZE = 20;
const job = (jobId: string) => ({ params: { path: { job_id: jobId } } });

export const listReviews = (level: Level, page: number) =>
  call(
    api.GET("/api/v1/reviews", {
      params: { query: { level: String(level), page: String(page), page_size: String(PAGE_SIZE) } },
    }),
  );
export const getReview = (jobId: string) => call(api.GET("/api/v1/reviews/{job_id}", job(jobId)));
export const getResult = (jobId: string) => call(api.GET("/api/v1/ocr/jobs/{job_id}/result", job(jobId)));
export const listChanges = (jobId: string) => call(api.GET("/api/v1/ocr/jobs/{job_id}/changes", job(jobId)));
export const decideReview = (jobId: string, level: Level, decision: Decision, comment: string | null) =>
  call(api.POST("/api/v1/reviews/{job_id}/decision", { ...job(jobId), body: { level, decision, comment } }));
export const getReviewSettings = () => call(api.GET("/api/v1/review-settings"));
export const setReviewLevel = (templateId: number | null, level: 0 | 1 | 2) =>
  call(api.PUT("/api/v1/review-settings/levels", { body: { template_id: templateId, level } }));
export const setReviewEmail = (enabled: boolean) =>
  call(api.PUT("/api/v1/review-settings/email", { body: { enabled } }));

/** Review levels the current tenant lets this user decide; none outside an organization. */
export function heldLevels(tenant: CurrentTenant | null): Level[] {
  if (!tenant || tenant.kind !== "organization") return [];
  const has = (p: string) => tenant.is_owner || tenant.permissions.includes(p);
  return ([1, 2] as Level[]).filter((l) => has(`review_l${l}`));
}

export function useReviewQueue(level: Level, page: number) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["reviews", tenant?.tenant_id, level, page],
    queryFn: () => listReviews(level, page),
    enabled: tenant !== null,
  });
}

export function useReviewDetail(jobId: string) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["review", tenant?.tenant_id, jobId],
    queryFn: () => getReview(jobId),
    enabled: tenant !== null,
    retry: false,
  });
}

export function useResult(jobId: string, enabled: boolean) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["result", tenant?.tenant_id, jobId],
    queryFn: () => getResult(jobId),
    enabled: enabled && tenant !== null,
  });
}

export function useChanges(jobId: string, enabled: boolean) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["changes", tenant?.tenant_id, jobId],
    queryFn: () => listChanges(jobId),
    enabled: enabled && tenant !== null,
  });
}
