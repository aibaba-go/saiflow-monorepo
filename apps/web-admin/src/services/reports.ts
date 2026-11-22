import type { components } from "@saiflow/api-client";
import type { QueryResult, ReportConfig } from "@saiflow/ui";
import type { DesignerFields, DesignerTemplate, ReportProblem } from "@saiflow/ui/report-designer";

import { api, call } from "./api";
import { ApiError } from "./errors";

/** Platform-admin report configuration of one organization (FR-SYS-143): drafts, publication
 * and a preview built from synthetic rows. There is no data or CSV call: the admin never sees
 * a customer's real statistics. */
export type ReportSummary = components["schemas"]["ReportSummary"];
export type ReportDetail = components["schemas"]["ReportDetail"];

export const reportKeys = {
  lists: ["admin-reports", "list"] as const,
  list: (tenantId: number) => ["admin-reports", "list", tenantId] as const,
  one: (id: number) => ["admin-reports", "one", id] as const,
  catalog: (tenantId: number, id: number) => ["admin-reports", "catalog", tenantId, id] as const,
};

const rid = (id: number) => ({ params: { path: { report_id: id } } });
const body = (config: ReportConfig) => config as unknown as Record<string, unknown>;

export const reports = {
  homepageTemplates: (signal: AbortSignal) => call(api.GET("/api/v1/admin/reports/homepage-templates", { signal })),
  contentPolicy: () => call(api.GET("/api/v1/admin/reports/content-policy")),
  uploadAsset: async (tenantId: number, file: File, signal: AbortSignal): Promise<string> => {
    const bytes = new Uint8Array(await file.arrayBuffer());
    signal.throwIfAborted();
    const result = await call(api.POST("/api/v1/admin/reports/assets", {
      signal, params: { query: { tenant_id: tenantId } }, body: bytes as never,
      bodySerializer: (b: unknown) => b as BodyInit, headers: { "Content-Type": "application/octet-stream" },
    }));
    return result.asset_id;
  },
  readAsset: (tenantId: number, assetId: string, signal: AbortSignal) => call(api.GET("/api/v1/admin/reports/assets/{asset_id}", {
    signal, params: { path: { asset_id: assetId }, query: { tenant_id: tenantId } }, parseAs: "blob",
  })) as Promise<Blob>,
  list: (tenantId: number) =>
    call(api.GET("/api/v1/admin/reports", { params: { query: { tenant_id: tenantId } } })),
  create: (tenantId: number, name: string) =>
    call(api.POST("/api/v1/admin/reports", { body: { tenant_id: tenantId, name } })),
  get: (id: number) => call(api.GET("/api/v1/admin/reports/{report_id}", rid(id))),
  save: (id: number, revision: number, name: string, config: ReportConfig) =>
    call(api.PUT("/api/v1/admin/reports/{report_id}", { ...rid(id), body: { revision, name, config: body(config) } })),
  remove: (id: number, revision: number) =>
    call(api.DELETE("/api/v1/admin/reports/{report_id}", { params: { path: { report_id: id }, query: { revision } } })),
  publish: (id: number, revision: number) =>
    call(api.POST("/api/v1/admin/reports/{report_id}/publish", { ...rid(id), body: { revision } })),
  unpublish: (id: number, revision: number) =>
    call(api.POST("/api/v1/admin/reports/{report_id}/unpublish", { ...rid(id), body: { revision } })),
  /** The draft on screen over synthetic rows (the result carries `synthetic: true`). */
  preview: (id: number, config: ReportConfig, pages?: Record<string, number>, period: { from: string; to: string } | null = null, signal?: AbortSignal) =>
    call(
      api.POST("/api/v1/admin/reports/{report_id}/preview", { ...rid(id), signal, body: { config: body(config), period, ...(pages ? { pages } : {}) } }),
    ) as Promise<QueryResult>,
  /** The templates the organization's cards may bind. */
  templates: async (tenantId: number, reportId: number) =>
    (
      await call(
        api.GET("/api/v1/admin/reports/catalog/templates", {
          params: { query: { tenant_id: tenantId, report_id: reportId } },
        }),
      )
    ).items as DesignerTemplate[],
  fields: (tenantId: number, reportId: number, templateId: number, versionIds: number[]) =>
    call(
      api.GET("/api/v1/admin/reports/catalog/fields", {
        params: {
          query: { tenant_id: tenantId, template_id: templateId, version_ids: versionIds.join(","), report_id: reportId },
        },
      }),
    ) as Promise<DesignerFields>,
};

/** The page configuration of a stored draft (always a v1 page with a card list). */
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

export const sameJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);
