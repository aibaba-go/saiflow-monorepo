import type { ApiClient } from "./client";
import type { components } from "./generated/schema";

type HealthResponse = components["schemas"]["HealthResponse"];

export type BackendHealth = {
  state: "ok" | "degraded" | "unreachable";
  version?: string;
};

function isHealthBody(body: unknown): body is HealthResponse {
  if (typeof body !== "object" || body === null) return false;
  const b = body as Record<string, unknown>;
  return (
    (b.status === "ok" || b.status === "degraded") &&
    typeof b.version === "string" &&
    (b.database === "ok" || b.database === "error")
  );
}

/** Never throws: network errors, non-JSON bodies and unexpected shapes are "unreachable". */
export async function getBackendHealth(client: ApiClient): Promise<BackendHealth> {
  try {
    const { data, error, response } = await client.GET("/api/v1/health");
    const body: unknown = response.status === 200 ? data : error;
    if (!isHealthBody(body)) return { state: "unreachable" };
    if (response.status === 200 && body.status === "ok") return { state: "ok", version: body.version };
    if (response.status === 503) return { state: "degraded", version: body.version };
    return { state: "unreachable" };
  } catch {
    return { state: "unreachable" };
  }
}
