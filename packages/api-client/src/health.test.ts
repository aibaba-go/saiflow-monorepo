import { describe, expect, it } from "vitest";

import { createApiClient } from "./client";
import { getBackendHealth } from "./health";

function stubFetch(status: number, body: string, contentType = "application/json"): typeof fetch {
  return async () => new Response(body, { status, headers: { "Content-Type": contentType } });
}

describe("getBackendHealth", () => {
  it("returns ok with version on 200", async () => {
    const c = createApiClient({
      baseUrl: "http://x",
      fetch: stubFetch(200, '{"status":"ok","version":"abc","database":"ok"}'),
    });
    expect(await getBackendHealth(c)).toEqual({ state: "ok", version: "abc" });
  });

  it("returns degraded on 503 health body", async () => {
    const c = createApiClient({
      baseUrl: "http://x",
      fetch: stubFetch(503, '{"status":"degraded","version":"abc","database":"error"}'),
    });
    expect(await getBackendHealth(c)).toEqual({ state: "degraded", version: "abc" });
  });

  it("returns unreachable for non-JSON 502", async () => {
    const c = createApiClient({
      baseUrl: "http://x",
      fetch: stubFetch(502, "<html>Bad Gateway</html>", "text/html"),
    });
    expect(await getBackendHealth(c)).toEqual({ state: "unreachable" });
  });

  it("returns unreachable when fetch rejects", async () => {
    const c = createApiClient({
      baseUrl: "http://x",
      fetch: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    expect(await getBackendHealth(c)).toEqual({ state: "unreachable" });
  });

  it("returns unreachable for 200 with a body that is not a health response", async () => {
    const c = createApiClient({ baseUrl: "http://x", fetch: stubFetch(200, '{"hello":1}') });
    expect(await getBackendHealth(c)).toEqual({ state: "unreachable" });
  });
});
