import { afterEach, describe, expect, it } from "vitest";

import { mockApi, json } from "../test/mockApi";
import { api, call, setTenantHeaderSource } from "./api";
import { ApiError } from "./errors";

describe("api layer", () => {
  afterEach(() => setTenantHeaderSource(() => null));

  it("sends the CSRF header on unsafe methods only", async () => {
    const m = mockApi({
      "GET /api/v1/me": () => json(200, {}),
      "POST /api/v1/auth/guest": () => json(200, {}),
    });
    await call(api.GET("/api/v1/me"));
    await call(api.POST("/api/v1/auth/guest"));
    expect(m.calls[0]!.headers.get("X-Requested-With")).toBeNull();
    expect(m.calls[1]!.headers.get("X-Requested-With")).toBe("SaiFlow");
  });

  it("adds X-Tenant-Id from the registered source", async () => {
    const m = mockApi({ "GET /api/v1/billing/usage": () => json(200, {}) });
    setTenantHeaderSource(() => 42);
    await call(api.GET("/api/v1/billing/usage"));
    setTenantHeaderSource(() => null);
    await call(api.GET("/api/v1/billing/usage"));
    expect(m.calls[0]!.headers.get("X-Tenant-Id")).toBe("42");
    expect(m.calls[1]!.headers.get("X-Tenant-Id")).toBeNull();
  });

  it("turns an error body into ApiError", async () => {
    mockApi({
      "PATCH /api/v1/me": () =>
        json(400, { code: "validation_error", message_key: "error.validation", fields: ["phone"] }),
    });
    const err = await call(api.PATCH("/api/v1/me", { body: {} })).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, code: "validation_error", fields: ["phone"] });
  });

  it("turns a network failure into code network", async () => {
    mockApi({ "GET /api/v1/me": () => Promise.reject(new TypeError("Failed to fetch")) });
    const err = await call(api.GET("/api/v1/me")).catch((e) => e);
    expect(err).toMatchObject({ status: 0, code: "network" });
  });
});
