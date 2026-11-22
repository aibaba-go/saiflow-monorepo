import type { components } from "@saiflow/api-client";
import type { QueryResult, ReportConfig } from "@saiflow/ui";
import type { DesignerFields, DesignerTemplate, ReportProblem } from "@saiflow/ui/report-designer";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMe } from "../auth/session";

import { api, call } from "../services/api";
import { ApiError } from "../services/errors";
import { useTenant } from "../tenants/useTenant";

/** Report calls of web-pc (FR-SYS-141, FR-REPORT-001..018), typed from the generated client.
 * Every query is keyed by the current tenant, so a tenant switch never shows the other
 * account's reports or statistics. */
export type ReportSummary = components["schemas"]["ReportSummary"];
export type ReportDetail = components["schemas"]["ReportDetail"];
export type ReportSource = components["schemas"]["ReportSource"];
export interface Period {
  from: string;
  to: string;
}

const rid = (id: number) => ({ params: { path: { report_id: id } } });
const body = (config: ReportConfig) => config as unknown as Record<string, unknown>;

export const listReports = () => call(api.GET("/api/v1/reports"));
export const getReport = (id: number) => call(api.GET("/api/v1/reports/{report_id}", rid(id)));
export const createReport = (name: string) => call(api.POST("/api/v1/reports", { body: { name } }));
export const saveReport = (id: number, revision: number, name: string, config: ReportConfig) =>
  call(api.PUT("/api/v1/reports/{report_id}", { ...rid(id), body: { revision, name, config: body(config) } }));
export const deleteReport = (id: number, revision: number) =>
  call(api.DELETE("/api/v1/reports/{report_id}", { params: { path: { report_id: id }, query: { revision } } }));
export const publishReport = (id: number, revision: number) =>
  call(api.POST("/api/v1/reports/{report_id}/publish", { ...rid(id), body: { revision } }));
export const unpublishReport = (id: number, revision: number) =>
  call(api.POST("/api/v1/reports/{report_id}/unpublish", { ...rid(id), body: { revision } }));
export const previewReport = (id: number, config: ReportConfig, period: Period | null, pages?: Record<string, number>, signal?: AbortSignal) =>
  call(api.POST("/api/v1/reports/{report_id}/preview", { ...rid(id), signal, body: { config: body(config), period, ...(pages ? { pages } : {}) } })) as Promise<QueryResult>;
export const reportData = (id: number, period: Period | null, refresh: boolean, pages?: Record<string, number>) =>
  call(api.POST("/api/v1/reports/{report_id}/data", { ...rid(id), body: { period, refresh, ...(pages && Object.keys(pages).length ? { pages } : {}) } })) as Promise<QueryResult>;

export function useReportContentPolicy(wanted: boolean) {
  const { tenant } = useTenant();
  return useQuery({ queryKey: ["report-content-policy", tenant?.tenant_id],
    queryFn: () => call(api.GET("/api/v1/reports/content-policy")), enabled: wanted && !!tenant });
}

export const catalogTemplates = (reportId: number) =>
  call(api.GET("/api/v1/reports/catalog/templates", { params: { query: { report_id: reportId } } }));
export const catalogFields = (reportId: number, templateId: number, versionIds: number[]) =>
  call(
    api.GET("/api/v1/reports/catalog/fields", {
      params: { query: { template_id: templateId, version_ids: versionIds.join(","), report_id: reportId } },
    }),
  ) as Promise<DesignerFields>;

/** One card's aggregated rows as CSV (view + export; FR-REPORT-016), saved from the browser
 * under the server's name. The period is the page period on screen. */
export async function downloadCsv(id: number, cardId: string, period: Period | null, reportVersion: number, signal?: AbortSignal): Promise<void> {
  const blob = (await call(
    api.GET("/api/v1/reports/{report_id}/csv", {
      signal,
      params: {
        path: { report_id: id },
        query: { card_id: cardId, report_version: reportVersion, ...(period ? { from: period.from, to: period.to } : {}) },
      },
      parseAs: "blob",
    }),
  )) as unknown as Blob;
  signal?.throwIfAborted(); // cancellation must precede the browser download side effect
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `report-${id}-${cardId}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

const homepageKey = (userId: number | null | undefined, tenantId: number | undefined) => ["homepage", userId, tenantId] as const;

export function useHomepage() {
  const me = useMe();
  const { tenant } = useTenant();
  return useQuery({
    queryKey: homepageKey(me.data?.user_id, tenant?.tenant_id),
    queryFn: ({ signal }) => call(api.GET("/api/v1/me/homepage", { signal })),
    enabled: !!me.data && !!tenant,
  });
}

export function useDashboard() {
  const me = useMe();
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["dashboard", me.data?.user_id, tenant?.tenant_id],
    queryFn: ({ signal }) => call(api.GET("/api/v1/me/dashboard", { signal })),
    enabled: !!me.data && !!tenant,
  });
}

export function useHomepageChoice() {
  const client = useQueryClient();
  const me = useMe();
  const { tenant } = useTenant();
  const key = homepageKey(me.data?.user_id, tenant?.tenant_id);
  const mutation = useMutation({
    mutationFn: async ({ id, key }: { id: number | null; key: ReturnType<typeof homepageKey> }) => ({
      value: await call(api.PUT("/api/v1/me/homepage", { body: { report_id: id } })), key,
    }),
    onSuccess: ({ value, key }) => client.setQueryData(key, value),
  });
  return { choose: (id: number | null) => mutation.mutateAsync({ id, key }), pending: mutation.isPending, error: mutation.error };
}

export const uploadReportAsset = async (file: File, signal: AbortSignal): Promise<string> => {
  const bytes = new Uint8Array(await file.arrayBuffer());
  signal.throwIfAborted();
  const result = await call(api.POST("/api/v1/reports/assets", {
    signal, body: bytes as never, bodySerializer: (b: unknown) => b as BodyInit,
    headers: { "Content-Type": "application/octet-stream" },
  }));
  return result.asset_id;
};

export const readReportAsset = (assetId: string, reportId: number, signal: AbortSignal) =>
  call(api.GET("/api/v1/reports/assets/{asset_id}", {
    signal, params: { path: { asset_id: assetId }, query: { report_id: reportId } }, parseAs: "blob",
  })) as Promise<Blob>;

export function useReports() {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["reports", tenant?.tenant_id],
    queryFn: listReports,
    enabled: tenant !== null,
  });
}

export function useReport(id: number) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["report", tenant?.tenant_id, id],
    queryFn: () => getReport(id),
    enabled: tenant !== null && Number.isInteger(id) && id > 0,
  });
}

/** The templates a card may bind (manage only). */
export function useCatalog(reportId: number, enabled: boolean) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["report-catalog", tenant?.tenant_id, reportId],
    queryFn: async () => (await catalogTemplates(reportId)).items as DesignerTemplate[],
    enabled: enabled && tenant !== null,
  });
}

/** The page configuration of a stored draft / snapshot (always a v1 page with a card list). */
export function configOf(raw: Record<string, unknown> | null | undefined): ReportConfig {
  const cards = raw && Array.isArray(raw.cards) ? raw.cards : [];
  return { ...(raw ?? {}), version: 1, cards } as ReportConfig;
}

/** The problems of a refused publication or preview (422 report_invalid, details.errors). */
export function reportErrors(error: unknown): ReportProblem[] {
  if (!(error instanceof ApiError) || error.code !== "report_invalid") return [];
  const list = error.details?.errors;
  return Array.isArray(list)
    ? list.filter((e): e is ReportProblem => typeof e?.path === "string" && typeof e?.message === "string")
    : [];
}
