import type { components } from "@saiflow/api-client";
import type { PendingConfirmation, TemplateContent, TemplatePathError } from "@saiflow/ui/template-editor";

import type { T } from "../i18n";
import { PLAN_NAMES } from "../format";
import { api, call } from "./api";
import { ApiError } from "./errors";

type Schemas = components["schemas"];
export type TemplateSummary = Schemas["TemplateSummary"];
export type TemplateDetail = Schemas["TemplateDetail"];
export type TemplateVersion = Schemas["VersionDetail"];
export type Grant = Schemas["GrantOut"];
export type GrantBody = Omit<Schemas["GrantsIn"], "revision">;
export type GrantUser = Schemas["GrantUser"];
export type GrantOrganization = Schemas["GrantOrganization"];
export type Owner = Schemas["OwnerItem"];
export type PlanCode = NonNullable<Schemas["GrantsIn"]["plans"]>[number];
export type Sample = Schemas["SampleOut"];
export type SampleStatus = Sample["status"];

/** The grantable plans, in tier order; a grant names each one exactly (FR-TEMPLATE-009). */
export const GRANT_PLANS: readonly PlanCode[] = ["kinder", "starter", "intermediate", "advance"];

/** Where a new template goes: the system, or one customer tenant (personal or organization). */
export type TemplateTarget = { scope: "system" } | { scope: "tenant"; tenantId: number };

export interface ListFilter {
  scope: "all" | "system" | "tenant";
  tenantId: number | null;
  q: string;
}

export const templateKeys = {
  lists: ["admin-templates", "list"] as const,
  list: (filter: ListFilter) => ["admin-templates", "list", filter] as const,
  one: (id: number) => ["admin-templates", "one", id] as const,
  version: (id: number, versionId: number) => ["admin-templates", "one", id, "version", versionId] as const,
  owners: (q: string) => ["admin-templates", "owners", q] as const,
  users: (q: string) => ["admin-templates", "grant-users", q] as const,
  organizations: (q: string) => ["admin-templates", "grant-organizations", q] as const,
};

export const sampleKeys = {
  list: ["admin-template-samples", "list"] as const,
  one: (id: string) => ["admin-template-samples", "one", id] as const,
  page: (id: string, page: number) => ["admin-template-samples", "page", id, page] as const,
};

/** A sample still being worked on: its page reads it again until it settles. */
export const SAMPLE_RUNNING: readonly SampleStatus[] = ["QUEUED", "OCR_RUNNING", "GENERATING"];

const one = (id: number) => ({ path: { template_id: id } });
const CONFIRM_ATTRS: readonly string[] = ["required", "primary", "role"];

/** What is still unconfirmed, in the server's shape (the server only ever removes entries). */
function pendingBody(pending: readonly PendingConfirmation[]): Schemas["PendingConfirmation"][] {
  return pending
    .filter((p) => CONFIRM_ATTRS.includes(p.attr))
    .map((p) => ({ path: p.path, attr: p.attr as Schemas["PendingConfirmation"]["attr"], value: p.value }));
}

/** Where a template saved from a sample came from, and what it still has to confirm. */
export interface FromSample {
  sampleId: string;
  pending: readonly PendingConfirmation[];
}

/** Platform-admin template configuration (FR-SYS-142): configuration only, never customer
 * originals, OCR payloads, samples or results (the admin's own samples are below). */
export const templates = {
  list: (filter: ListFilter) =>
    call(
      api.GET("/api/v1/admin/templates", {
        params: {
          query: {
            scope: filter.scope === "all" ? undefined : filter.scope,
            tenant_id: filter.scope === "tenant" && filter.tenantId ? filter.tenantId : undefined,
            q: filter.q.trim() || undefined,
          },
        },
      }),
    ),
  /** A new draft, written by hand or from the admin's own READY sample (FR-TEMPLATE-008). */
  create: (target: TemplateTarget, content: TemplateContent, sample?: FromSample) =>
    call(
      api.POST("/api/v1/admin/templates", {
        body: {
          scope: target.scope,
          tenant_id: target.scope === "tenant" ? target.tenantId : undefined,
          content: content as unknown as Record<string, unknown>,
          ...(sample
            ? { source: "sample" as const, sample_id: sample.sampleId, pending_confirmations: pendingBody(sample.pending) }
            : { source: "manual" as const }),
        },
      }),
    ),
  get: (id: number) => call(api.GET("/api/v1/admin/templates/{template_id}", { params: one(id) })),
  saveDraft: (id: number, revision: number, content: TemplateContent, pending: readonly PendingConfirmation[]) =>
    call(
      api.PUT("/api/v1/admin/templates/{template_id}/draft", {
        params: one(id),
        body: {
          revision,
          content: content as unknown as Record<string, unknown>,
          // what is still unconfirmed; the server only ever removes entries (FR-TEMPLATE-008)
          pending_confirmations: pendingBody(pending),
        },
      }),
    ),
  discardDraft: (id: number, revision: number) =>
    call(
      api.DELETE("/api/v1/admin/templates/{template_id}/draft", {
        params: { ...one(id), query: { revision } },
      }),
    ),
  activate: (id: number, revision: number) =>
    call(api.POST("/api/v1/admin/templates/{template_id}/activate", { params: one(id), body: { revision } })),
  setStatus: (id: number, revision: number, status: "ENABLED" | "DISABLED") =>
    call(api.POST("/api/v1/admin/templates/{template_id}/status", { params: one(id), body: { revision, status } })),
  setGrants: (id: number, revision: number, body: GrantBody) =>
    call(api.PUT("/api/v1/admin/templates/{template_id}/grants", { params: one(id), body: { revision, ...body } })),
  remove: (id: number, revision: number) =>
    call(api.DELETE("/api/v1/admin/templates/{template_id}", { params: { ...one(id), query: { revision } } })),
  exportJson: (id: number, draft: boolean) =>
    call(
      api.GET("/api/v1/admin/templates/{template_id}/export", {
        params: { ...one(id), query: draft ? { draft: 1 } : {} },
      }),
    ),
  version: (id: number, versionId: number) =>
    call(
      api.GET("/api/v1/admin/templates/{template_id}/versions/{version_id}", {
        params: { path: { template_id: id, version_id: versionId } },
      }),
    ),
  owners: (q: string) =>
    call(api.GET("/api/v1/admin/templates/owners", { params: { query: { q } } })),
  grantUsers: (q: string) =>
    call(api.GET("/api/v1/admin/templates/grant-candidates/users", { params: { query: { q } } })),
  grantOrganizations: (q: string) =>
    call(api.GET("/api/v1/admin/templates/grant-candidates/organizations", { params: { query: { q } } })),
};

const smp = (id: string) => ({ params: { path: { sample_id: id } } });

/** The admin's own template samples (FR-SYS-142): an uploaded PDF/JPG/PNG, read by the
 * platform without any customer quota; visible to this admin account alone. */
export const samples = {
  list: () => call(api.GET("/api/v1/admin/template-samples")),
  get: (id: string) => call(api.GET("/api/v1/admin/template-samples/{sample_id}", smp(id))),
  /** The raw bytes (the backend sniffs the type itself). */
  upload: async (file: File) =>
    call(
      api.POST("/api/v1/admin/template-samples", {
        body: new Uint8Array(await file.arrayBuffer()) as never,
        bodySerializer: (b: unknown) => b as BodyInit,
        headers: { "Content-Type": "application/octet-stream" },
      }),
    ),
  retry: (id: string) => call(api.POST("/api/v1/admin/template-samples/{sample_id}/retry", smp(id))),
  cancel: (id: string) => call(api.POST("/api/v1/admin/template-samples/{sample_id}/cancel", smp(id))),
  remove: (id: string) => call(api.DELETE("/api/v1/admin/template-samples/{sample_id}", smp(id))),
  page: (id: string, page: number) =>
    call(
      api.GET("/api/v1/admin/template-samples/{sample_id}/pages/{page}", {
        params: { path: { sample_id: id, page } },
        parseAs: "blob",
      }),
    ) as Promise<Blob>,
};

/** The content keys of a template; anything else (owner, grant, status) is dropped. */
export function pickContent(raw: Record<string, unknown>): TemplateContent {
  return {
    code: typeof raw.code === "string" ? raw.code : "",
    name: typeof raw.name === "string" ? raw.name : "",
    ...(raw.names && typeof raw.names === "object" ? { names: raw.names as TemplateContent["names"] } : {}),
    description: typeof raw.description === "string" ? raw.description : "",
    groups: Array.isArray(raw.groups) ? (raw.groups as TemplateContent["groups"]) : [],
  };
}

/** A blank template to start from. */
export function emptyContent(): TemplateContent {
  return { code: "", name: "", description: "", groups: [] };
}

/** What the editor starts from: the saved draft, else the active version, else blank. */
export function editableContent(detail: TemplateDetail): TemplateContent {
  if (detail.draft) return { ...emptyContent(), ...(detail.draft as Partial<TemplateContent>) } as TemplateContent;
  return versionContent(detail.code, detail.current);
}

export function versionContent(code: string, version: TemplateVersion | null): TemplateContent {
  if (!version) return { ...emptyContent(), code };
  return {
    code,
    name: version.name,
    description: version.description ?? "",
    groups: version.groups as unknown as TemplateContent["groups"],
  };
}

/** Path errors carried by a 422 template_invalid (details.errors), or [] for any other error. */
export function pathErrors(error: unknown): TemplatePathError[] {
  if (!(error instanceof ApiError)) return [];
  const list = error.details?.errors;
  if (!Array.isArray(list)) return [];
  return list.filter(
    (e): e is TemplatePathError =>
      typeof e === "object" && e !== null && typeof (e as TemplatePathError).path === "string",
  );
}

export function isCode(error: unknown, code: string): boolean {
  return error instanceof ApiError && error.code === code;
}

/** The protections of a 409 template_in_use (details.reasons). */
export function inUseReasons(error: unknown): string[] {
  if (!isCode(error, "template_in_use")) return [];
  const reasons = (error as ApiError).details?.reasons;
  return Array.isArray(reasons) ? reasons.filter((r): r is string => typeof r === "string") : [];
}

/** One line for a system template's grant: plans, named targets, or not granted. */
export function grantSummary(grant: Grant | null | undefined, t: T): string {
  if (!grant || !grant.mode) return t("tpl.grant.none");
  if (grant.mode === "PLANS") {
    return t("tpl.grant.plansSummary", { plans: grant.plans.map((p) => PLAN_NAMES[p] ?? p).join(", ") });
  }
  return t("tpl.grant.targetsSummary", { users: grant.users.length, orgs: grant.organizations.length });
}

/** "Personal · name (email)" / "Organization · name" for an owner tenant. */
export function ownerLabel(owner: Owner, t: T): string {
  const name = owner.name || t("tenant.ref", { id: owner.tenant_id });
  const who = owner.email ? `${name} (${owner.email})` : name;
  return `${t(owner.kind === "personal" ? "kind.personal" : "kind.organization")} · ${who}`;
}

export function userLabel(user: GrantUser): string {
  const name = user.display_name || `#${user.id}`;
  return user.email ? `${name} (${user.email})` : name;
}

/** Save a JSON file in the browser. */
export function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
