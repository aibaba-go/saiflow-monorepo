import type { DataSourceApi } from "@saiflow/ui/data-sources";
import { api, call } from "./api";

export function adminDataSources(tenantId: number | null): DataSourceApi {
  const query = tenantId ? { tenant_id: tenantId } : {};
  return {
    tables: (id, signal) => call(api.GET("/api/v1/admin/data-sources/{source_id}/tables", { params: { path: { source_id: id }, query }, signal })),
    list: signal => call(api.GET("/api/v1/admin/data-sources", { params: { query }, signal })),
    save: (body, id) => id
      ? call(api.PUT("/api/v1/admin/data-sources/{source_id}", { params: { path: { source_id: id }, query: { tenant_id: tenantId! } }, body }))
      : call(api.POST("/api/v1/admin/data-sources", { params: { query: { tenant_id: tenantId! } }, body })),
    remove: id => call(api.DELETE("/api/v1/admin/data-sources/{source_id}", { params: { path: { source_id: id }, query: { tenant_id: tenantId! } } })),
    test: (id, signal) => call(api.POST("/api/v1/admin/data-sources/{source_id}/test", { params: { path: { source_id: id }, query }, signal })),
    query: (id, sql, page, signal) => call(api.POST("/api/v1/admin/data-sources/{source_id}/query", { params: { path: { source_id: id }, query }, body: { sql, page, page_size: 20 }, signal })),
  };
}
