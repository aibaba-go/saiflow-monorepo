import type { DataSourceApi } from "@saiflow/ui/data-sources";
import { api, call } from "../services/api";

export const dataSources: DataSourceApi = {
  tables: (id, signal) => call(api.GET("/api/v1/data-sources/{source_id}/tables", { params: { path: { source_id: id } }, signal })),
  list: signal => call(api.GET("/api/v1/data-sources", { signal })),
  save: (body, id) => id
    ? call(api.PUT("/api/v1/data-sources/{source_id}", { params: { path: { source_id: id } }, body }))
    : call(api.POST("/api/v1/data-sources", { body })),
  remove: id => call(api.DELETE("/api/v1/data-sources/{source_id}", { params: { path: { source_id: id } } })),
  test: (id, signal) => call(api.POST("/api/v1/data-sources/{source_id}/test", { params: { path: { source_id: id } }, signal })),
  query: (id, sql, page, signal) => call(api.POST("/api/v1/data-sources/{source_id}/query", { params: { path: { source_id: id } }, body: { sql, page, page_size: 20 }, signal })),
};
