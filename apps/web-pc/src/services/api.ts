// Ported from apps/line-mini/src/services/api.ts (web-pc-account plan: copied, not shared).
import { createApiClient, type ApiClient } from "@saiflow/api-client";

import { apiBaseUrl } from "../config";
import { ApiError } from "./errors";

/** The one API client of the app. fetch is looked up per call so tests can stub it. */
export const api: ApiClient = createApiClient({
  baseUrl: apiBaseUrl,
  fetch: (input: RequestInfo | URL, init?: RequestInit) => globalThis.fetch(input, init),
});

const UNSAFE = new Set(["POST", "PUT", "PATCH", "DELETE"]);
let tenantSource: () => number | null = () => null;

/** Who decides the X-Tenant-Id header: the current tenant, or null for the own tenant. */
export function setTenantHeaderSource(get: () => number | null): void {
  tenantSource = get;
}

api.use({
  onRequest({ request }) {
    if (UNSAFE.has(request.method)) request.headers.set("X-Requested-With", "SaiFlow");
    const tenant = tenantSource();
    if (tenant !== null) request.headers.set("X-Tenant-Id", String(tenant));
    return request;
  },
});

let onTenantGone: () => void = () => {};

/** Called when a request for the current organization answers 404: the organization is no
 * longer usable (removed, left, disabled), wherever the user is (Review Focus 4). */
export function setTenantGoneHandler(handler: () => void): void {
  onTenantGone = handler;
}

api.use({
  onResponse({ request, response }) {
    if (response.status === 404 && request.headers.has("X-Tenant-Id")) onTenantGone();
    return response;
  },
});

type Unauthenticated = (error: ApiError) => void;
let onUnauthenticated: Unauthenticated = () => {};

/** Called for every 401 that the caller did not opt out of (FR-SYS-055-04). */
export function setUnauthenticatedHandler(handler: Unauthenticated): void {
  onUnauthenticated = handler;
}

interface Result<T> {
  data?: T;
  error?: unknown;
  response: Response;
}

interface CallOptions {
  /** This call handles 401 itself (boot, login): do not trigger the global handler. */
  own401?: boolean;
}

/** Await an api.* call: its data, or an ApiError (code "network" when unreachable). */
export async function call<T>(request: Promise<Result<T>>, options: CallOptions = {}): Promise<T> {
  let result: Result<T>;
  try {
    result = await request;
  } catch {
    throw new ApiError(0, "network", []);
  }
  if (result.response.ok) return result.data as T;
  const body = (result.error ?? {}) as {
    code?: string;
    fields?: string[] | null;
    details?: Record<string, unknown> | null;
  };
  const error = new ApiError(
    result.response.status,
    body.code ?? "unknown",
    body.fields ?? [],
    body.details ?? undefined,
  );
  if (error.status === 401 && !options.own401) onUnauthenticated(error);
  throw error;
}
