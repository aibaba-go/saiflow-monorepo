import type { components } from "@saiflow/api-client";
import type { PathRemap, PendingConfirmation, TemplateContent, TemplatePathError } from "@saiflow/ui/template-editor";
import { useQuery } from "@tanstack/react-query";

import { api, call } from "../services/api";
import { ApiError } from "../services/errors";
import { useTenant } from "../tenants/useTenant";

/** Template management and sample calls of web-pc (FR-SYS-140, FR-TEMPLATE-001..014),
 * typed from the generated client. Every query is keyed by the current tenant, so a
 * tenant switch never shows the other account's templates (AC-FR-SYS-140-03). */
export type TemplateSummary = components["schemas"]["TemplateSummary"];
export type TemplateDetail = components["schemas"]["TemplateDetail"];
export type VersionDetail = components["schemas"]["VersionDetail"];
export type Sample = components["schemas"]["SampleOut"];
export type Source = components["schemas"]["CreateTemplateIn"]["source"];
type Pending = components["schemas"]["PendingConfirmation"];

const tpl = (id: number) => ({ params: { path: { template_id: id } } });
const smp = (id: string) => ({ params: { path: { sample_id: id } } });
const pendingOut = (list: readonly PendingConfirmation[]): Pending[] =>
  list.map((p) => ({ path: p.path, attr: p.attr as Pending["attr"], value: p.value }));

export const listTemplates = () => call(api.GET("/api/v1/managed-templates"));
export const getTemplate = (id: number) => call(api.GET("/api/v1/managed-templates/{template_id}", tpl(id)));
export const getVersion = (id: number, versionId: number) =>
  call(
    api.GET("/api/v1/managed-templates/{template_id}/versions/{version_id}", {
      params: { path: { template_id: id, version_id: versionId } },
    }),
  );
export const createTemplate = (
  content: TemplateContent,
  source: Source,
  extra: { sampleId?: string; pending?: readonly PendingConfirmation[] } = {},
) =>
  call(
    api.POST("/api/v1/managed-templates", {
      body: {
        content: content as unknown as Record<string, unknown>,
        source,
        ...(extra.sampleId ? { sample_id: extra.sampleId } : {}),
        ...(extra.pending ? { pending_confirmations: pendingOut(extra.pending) } : {}),
      },
    }),
  );
export const saveDraft = (id: number, revision: number, content: TemplateContent, pending: readonly PendingConfirmation[]) =>
  call(
    api.PUT("/api/v1/managed-templates/{template_id}/draft", {
      ...tpl(id),
      body: { revision, content: content as unknown as Record<string, unknown>, pending_confirmations: pendingOut(pending) },
    }),
  );
export const discardDraft = (id: number, revision: number) =>
  call(
    api.DELETE("/api/v1/managed-templates/{template_id}/draft", {
      params: { path: { template_id: id }, query: { revision } },
    }),
  );
export const activate = (id: number, revision: number) =>
  call(api.POST("/api/v1/managed-templates/{template_id}/activate", { ...tpl(id), body: { revision } }));
export const setStatus = (id: number, revision: number, status: "ENABLED" | "DISABLED") =>
  call(api.POST("/api/v1/managed-templates/{template_id}/status", { ...tpl(id), body: { revision, status } }));
export const deleteTemplate = (id: number, revision: number) =>
  call(
    api.DELETE("/api/v1/managed-templates/{template_id}", {
      params: { path: { template_id: id }, query: { revision } },
    }),
  );
export const exportTemplate = (id: number, draft: boolean) =>
  call(
    api.GET("/api/v1/managed-templates/{template_id}/export", {
      params: { path: { template_id: id }, query: draft ? { draft: 1 } : {} },
    }),
  );

export const listSamples = () => call(api.GET("/api/v1/template-samples"));
export const getSample = (id: string) => call(api.GET("/api/v1/template-samples/{sample_id}", smp(id)));
/** The raw bytes, like the OCR upload body (the backend sniffs the type itself). */
export const uploadSample = async (file: File) =>
  call(
    api.POST("/api/v1/template-samples", {
      body: new Uint8Array(await file.arrayBuffer()) as never,
      bodySerializer: (b: unknown) => b as BodyInit,
      headers: { "Content-Type": "application/octet-stream" },
    }),
  );
export const sampleFromJob = (jobId: string) =>
  call(api.POST("/api/v1/template-samples/from-job", { body: { job_id: jobId } }));
export const retrySample = (id: string) => call(api.POST("/api/v1/template-samples/{sample_id}/retry", smp(id)));
export const cancelSample = (id: string) => call(api.POST("/api/v1/template-samples/{sample_id}/cancel", smp(id)));
export const deleteSample = (id: string) => call(api.DELETE("/api/v1/template-samples/{sample_id}", smp(id)));
export const samplePage = (id: string, page: number) =>
  call(
    api.GET("/api/v1/template-samples/{sample_id}/pages/{page}", {
      params: { path: { sample_id: id, page } },
      parseAs: "blob",
    }),
  ) as Promise<Blob>;

export const RUNNING: readonly Sample["status"][] = ["QUEUED", "OCR_RUNNING", "GENERATING"];

export function useTemplates() {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["managed-templates", tenant?.tenant_id],
    queryFn: listTemplates,
    enabled: tenant !== null,
  });
}

export function useTemplate(id: number) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["managed-template", tenant?.tenant_id, id],
    queryFn: () => getTemplate(id),
    enabled: tenant !== null && Number.isInteger(id) && id > 0,
  });
}

export function useVersion(id: number, versionId: number | null) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["managed-template-version", tenant?.tenant_id, id, versionId],
    queryFn: () => getVersion(id, versionId!),
    enabled: tenant !== null && versionId !== null,
  });
}

export function useSamples(enabled = true) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["template-samples", tenant?.tenant_id],
    queryFn: listSamples,
    enabled: enabled && tenant !== null,
    // a sample still in progress: its row follows along
    refetchInterval: (q) => (q.state.data?.items.some((s) => RUNNING.includes(s.status)) ? 5000 : false),
  });
}

/** One sample, read again every 2 s until it settles (FR-TEMPLATE-014). */
export function useSample(id: string) {
  const { tenant } = useTenant();
  return useQuery({
    queryKey: ["template-sample", tenant?.tenant_id, id],
    queryFn: () => getSample(id),
    enabled: tenant !== null && Boolean(id),
    refetchInterval: (q) => (q.state.data && RUNNING.includes(q.state.data.status) ? 2000 : false),
  });
}

/** The content keys of a template (FR-TEMPLATE-011): anything else in a file is dropped. */
export function pickContent(raw: Record<string, unknown>): TemplateContent {
  return {
    code: typeof raw.code === "string" ? raw.code : "",
    name: typeof raw.name === "string" ? raw.name : "",
    ...(raw.names && typeof raw.names === "object" ? { names: raw.names as TemplateContent["names"] } : {}),
    description: typeof raw.description === "string" ? raw.description : "",
    groups: Array.isArray(raw.groups) ? (raw.groups as TemplateContent["groups"]) : [],
  };
}

export const BLANK: TemplateContent = { code: "", name: "", description: "", groups: [] };

/** What the editor opens with: the draft, else the active version, else blank. */
export function contentOf(detail: TemplateDetail): TemplateContent {
  if (detail.draft) return pickContent(detail.draft);
  if (detail.current) return versionContent(detail.code, detail.current);
  return { ...BLANK, code: detail.code, name: detail.name };
}

export function versionContent(code: string, v: VersionDetail): TemplateContent {
  return pickContent({ code, name: v.name, description: v.description ?? "", groups: v.groups });
}

/** The path errors of a refused activation (422 template_invalid, details.errors). */
export function pathErrors(error: unknown): TemplatePathError[] {
  if (!(error instanceof ApiError) || error.code !== "template_invalid") return [];
  const list = error.details?.errors;
  return Array.isArray(list)
    ? list.filter((e): e is TemplatePathError => typeof e?.path === "string" && typeof e?.message === "string")
    : [];
}

/** The pending confirmations of a template as the editor takes them. */
export const pendingIn = (list: readonly Pending[]): PendingConfirmation[] =>
  list.map((p) => ({ path: p.path, attr: p.attr, value: p.value }));

/** Pending confirmations follow their rows after a reorder; a removed row drops its own. */
export function remapPending(list: readonly PendingConfirmation[], remap: PathRemap): PendingConfirmation[] {
  return list.flatMap((p) => {
    const path = remap(p.path);
    return path === null ? [] : [{ ...p, path }];
  });
}

/** Key-order independent comparison of two JSON values. */
export function sameJson(a: unknown, b: unknown): boolean {
  const norm = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(norm)
      : v && typeof v === "object"
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .filter(([, x]) => x !== undefined)
              .sort(([x], [y]) => (x < y ? -1 : 1))
              .map(([k, x]) => [k, norm(x)]),
          )
        : v;
  return JSON.stringify(norm(a)) === JSON.stringify(norm(b));
}

/** Save a JSON value as a file from the browser. */
export function downloadJson(value: unknown, name: string): void {
  const blob = new Blob([JSON.stringify(value, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
