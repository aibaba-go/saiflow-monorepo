import type { components } from "@saiflow/api-client";

import { api, call } from "../../services/api";
import type { Lang } from "../../stores/language";

/** The scan pages' calls, typed from the generated client. main's pages called main's own
 * API; these keep our endpoints and rules (A5). */
export type FileOut = components["schemas"]["FileOut"];
export type JobOut = components["schemas"]["JobOut"];
export type JobPageOut = components["schemas"]["JobPageOut"];
export type ResultOut = components["schemas"]["ResultOut"];
export type TemplateOptionsOut = components["schemas"]["TemplateOptionsOut"];
export type TemplateVersionOut = components["schemas"]["TemplateVersionOut"];

const file = (fileId: string) => ({ params: { path: { file_id: fileId } } });
const job = (jobId: string) => ({ params: { path: { job_id: jobId } } });

export const listPending = () => call(api.GET("/api/v1/files/pending"));
export const getFile = (fileId: string) => call(api.GET("/api/v1/files/{file_id}", file(fileId)));
export const deleteFile = (fileId: string) => call(api.DELETE("/api/v1/files/{file_id}", file(fileId)));
export const importUrl = (url: string) => call(api.POST("/api/v1/file-imports", { body: { url } }));

export function listJobs(q: { page: number; pageSize: number; stage?: string; q?: string }) {
  const query: Record<string, string> = { page: String(q.page), page_size: String(q.pageSize) };
  if (q.stage) query.stage = q.stage;
  if (q.q) query.q = q.q;
  return call(api.GET("/api/v1/ocr/jobs", { params: { query } }));
}

export const getJob = (jobId: string) => call(api.GET("/api/v1/ocr/jobs/{job_id}", job(jobId)));
export const cancelJob = (jobId: string) => call(api.POST("/api/v1/ocr/jobs/{job_id}/cancel", job(jobId)));
export const rerunJob = (jobId: string) => call(api.POST("/api/v1/ocr/jobs/{job_id}/rerun", job(jobId)));

export const getResult = (jobId: string) =>
  call(api.GET("/api/v1/ocr/jobs/{job_id}/result", job(jobId)));

export function saveResult(jobId: string, expectedVersion: number, structured: unknown, confirm = false, signal?: AbortSignal, own401 = false) {
  return call(
    api.PATCH("/api/v1/ocr/jobs/{job_id}/result", {
      ...job(jobId),
      body: { expected_version: expectedVersion, structured, confirm },
      signal,
    }),
    { own401 },
  );
}

export const templateOptions = (jobId: string) =>
  call(api.GET("/api/v1/ocr/jobs/{job_id}/template-options", job(jobId)));
export const templateVersion = (versionId: number) =>
  call(api.GET("/api/v1/templates/versions/{version_id}", { params: { path: { version_id: versionId } } }));
export const applyTemplate = (jobId: string, versionId: number) =>
  call(api.POST("/api/v1/ocr/jobs/{job_id}/template", { ...job(jobId), body: { template_version_id: versionId } }));
export const chooseGeneric = (jobId: string) => call(api.POST("/api/v1/ocr/jobs/{job_id}/generic", job(jobId)));

export const createExport = (jobId: string, language: Lang) =>
  call(api.POST("/api/v1/ocr/jobs/{job_id}/exports", { ...job(jobId), body: { language } }));
export const getExport = (exportId: string) =>
  call(api.GET("/api/v1/exports/{export_id}", { params: { path: { export_id: exportId } } }));
