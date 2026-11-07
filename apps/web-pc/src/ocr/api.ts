import type { components } from "@saiflow/api-client";
import { useQuery } from "@tanstack/react-query";

import { api, call } from "../services/api";
import { useTenant } from "../tenants/useTenant";

/** OCR calls of the web-pc pages (FR-SYS-127-131), typed from the generated client. */
export type JobOut = components["schemas"]["JobOut"];
export type JobPageOut = components["schemas"]["JobPageOut"];
export type ResultOut = components["schemas"]["ResultOut"];
export type FileOut = components["schemas"]["FileOut"];
export type TemplateOptionsOut = components["schemas"]["TemplateOptionsOut"];

export interface JobFilters {
  page: number;
  pageSize: number;
  stage?: string;
  q?: string;
  template?: string;
  createdFrom?: string;
  createdTo?: string;
}

const job = (jobId: string) => ({ params: { path: { job_id: jobId } } });
const file = (fileId: string) => ({ params: { path: { file_id: fileId } } });

export function listJobs(f: JobFilters) {
  const query: Record<string, string> = { page: String(f.page), page_size: String(f.pageSize) };
  if (f.stage) query.stage = f.stage;
  if (f.q) query.q = f.q;
  if (f.template) query.template = f.template;
  if (f.createdFrom) query.created_from = f.createdFrom;
  if (f.createdTo) query.created_to = f.createdTo;
  return call(api.GET("/api/v1/ocr/jobs", { params: { query } }));
}
export const getJob = (jobId: string) => call(api.GET("/api/v1/ocr/jobs/{job_id}", job(jobId)));
export const cancelJob = (jobId: string) => call(api.POST("/api/v1/ocr/jobs/{job_id}/cancel", job(jobId)));
export const rerunJob = (jobId: string) => call(api.POST("/api/v1/ocr/jobs/{job_id}/rerun", job(jobId)));
export const createJob = (fileId: string, key: string) =>
  call(api.POST("/api/v1/ocr/jobs", { body: { file_id: fileId, idempotency_key: key } }));
export const getResult = (jobId: string) => call(api.GET("/api/v1/ocr/jobs/{job_id}/result", job(jobId)));
export const saveResult = (jobId: string, expectedVersion: number, structured: unknown, confirm = false) =>
  call(
    api.PATCH("/api/v1/ocr/jobs/{job_id}/result", {
      ...job(jobId),
      body: { expected_version: expectedVersion, structured, confirm },
    }),
  );
export const templateOptions = (jobId: string) =>
  call(api.GET("/api/v1/ocr/jobs/{job_id}/template-options", job(jobId)));
export const applyTemplate = (jobId: string, versionId: number) =>
  call(api.POST("/api/v1/ocr/jobs/{job_id}/template", { ...job(jobId), body: { template_version_id: versionId } }));
export const chooseGeneric = (jobId: string) => call(api.POST("/api/v1/ocr/jobs/{job_id}/generic", job(jobId)));
export const listPending = () => call(api.GET("/api/v1/files/pending"));
export const deleteFile = (fileId: string) => call(api.DELETE("/api/v1/files/{file_id}", file(fileId)));

export function useJob(id: string, poll = false) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["job", tenant?.tenant_id, id],
    queryFn: () => getJob(id),
    enabled: tenant !== null && Boolean(id),
    refetchInterval: (q) =>
      poll && q.state.data && ["OCR_PROCESSING", "TEMPLATE_MATCHING"].includes(q.state.data.stage) ? 3000 : false,
  });
}

export function useResult(id: string, enabled = true) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["result", tenant?.tenant_id, id],
    queryFn: () => getResult(id),
    enabled: enabled && tenant !== null && Boolean(id),
    retry: false,
    // a template conversion in progress: check again until it settles
    refetchInterval: (q) =>
      q.state.data?.mapping && ["PENDING", "MATCHING", "CONVERTING"].includes(q.state.data.mapping.status) ? 3000 : false,
  });
}

export function useJobs(f: JobFilters, options: { refetchInterval?: number | false } = {}) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["jobs", tenant?.tenant_id, f],
    queryFn: () => listJobs(f),
    enabled: tenant !== null,
    refetchInterval: options.refetchInterval,
  });
}
