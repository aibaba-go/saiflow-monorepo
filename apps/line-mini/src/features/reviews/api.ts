import type { components } from "@saiflow/api-client";
import { useInfiniteQuery, useQuery } from "@tanstack/react-query";

import { api, call } from "../../services/api";
import { useCurrentTenant } from "../tenants/useCurrentTenant";

/** Review calls (FR-VERIFY-010, 019, 012, 013; FR-SYS-119-122), typed from the client. */
export type ReviewItem = components["schemas"]["ReviewItemOut"];
export type ReviewDetail = components["schemas"]["ReviewDetailOut"];
export type ReviewSummary = components["schemas"]["ReviewSummaryOut"];
export type ReviewSettings = components["schemas"]["ReviewSettingsOut"];
export type ReviewRecord = components["schemas"]["ReviewRecordOut"];
export type ChangeEntry = components["schemas"]["ChangeOut"];
export type Level = 1 | 2;
export type Decision = "approve" | "return";

export const PAGE_SIZE = 20;
const job = (jobId: string) => ({ params: { path: { job_id: jobId } } });

export const reviewSummary = () => call(api.GET("/api/v1/reviews/summary"));
export const listReviews = (level: Level, page: number) =>
  call(
    api.GET("/api/v1/reviews", {
      params: { query: { level: String(level), page: String(page), page_size: String(PAGE_SIZE) } },
    }),
  );
export const getReview = (jobId: string) => call(api.GET("/api/v1/reviews/{job_id}", job(jobId)));
export const decideReview = (jobId: string, level: Level, decision: Decision, comment: string | null) =>
  call(api.POST("/api/v1/reviews/{job_id}/decision", { ...job(jobId), body: { level, decision, comment } }));
export const getReviewSettings = () => call(api.GET("/api/v1/review-settings"));
export const setReviewLevel = (templateId: number | null, level: 0 | 1 | 2) =>
  call(api.PUT("/api/v1/review-settings/levels", { body: { template_id: templateId, level } }));
export const setReviewEmail = (enabled: boolean) =>
  call(api.PUT("/api/v1/review-settings/email", { body: { enabled } }));
export const listChanges = (jobId: string) => call(api.GET("/api/v1/ocr/jobs/{job_id}/changes", job(jobId)));

/** Review levels the current tenant lets this user decide; none outside an organization. */
export function heldLevels(tenant: ReturnType<typeof useCurrentTenant>["tenant"]): Level[] {
  if (!tenant || tenant.kind !== "organization") return [];
  const has = (p: string) => tenant.is_owner || tenant.permissions.includes(p);
  return ([1, 2] as Level[]).filter((l) => has(`review_l${l}`));
}

export function useReviewSummary(enabled: boolean) {
  const { tenant } = useCurrentTenant();
  return useQuery({
    queryKey: ["reviewSummary", tenant?.tenant_id],
    queryFn: reviewSummary,
    enabled: enabled && tenant !== null,
  });
}

export function useReviewQueue(level: Level) {
  const { tenant } = useCurrentTenant();
  return useInfiniteQuery({
    queryKey: ["reviews", tenant?.tenant_id, level],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => listReviews(level, pageParam),
    getNextPageParam: (last) => (last.page * last.page_size < last.total ? last.page + 1 : undefined),
    enabled: tenant !== null,
  });
}

export function useReviewDetail(jobId: string) {
  const { tenant } = useCurrentTenant();
  return useQuery({
    queryKey: ["review", tenant?.tenant_id, jobId],
    queryFn: () => getReview(jobId),
    enabled: tenant !== null,
    retry: false,
  });
}

export function useReviewSettings(enabled: boolean) {
  const { tenant } = useCurrentTenant();
  return useQuery({
    queryKey: ["reviewSettings", tenant?.tenant_id],
    queryFn: getReviewSettings,
    enabled: enabled && tenant !== null,
  });
}
