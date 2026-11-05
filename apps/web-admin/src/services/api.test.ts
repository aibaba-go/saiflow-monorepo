import { describe, expect, it } from "vitest";

import { mockApi, json } from "../test/mockApi";
import { api, call } from "./api";
import { ApiError } from "./errors";

describe("api layer", () => {
  it("sends the CSRF header on unsafe methods only", async () => {
    const m = mockApi({
      "GET /api/v1/admin/me": () => json(200, {}),
      "POST /api/v1/admin/auth/logout": () => json(200, {}),
    });
    await call(api.GET("/api/v1/admin/me"));
    await call(api.POST("/api/v1/admin/auth/logout"));
    expect(m.calls[0]!.headers.get("X-Requested-With")).toBeNull();
    expect(m.calls[1]!.headers.get("X-Requested-With")).toBe("SaiFlow");
  });

  it("turns an error body into ApiError", async () => {
    mockApi({
      "PATCH /api/v1/admin/plans/starter": () =>
        json(400, { code: "validation_error", message_key: "error.validation", fields: ["phone"] }),
    });
    const err = await call(
      api.PATCH("/api/v1/admin/plans/{code}", { params: { path: { code: "starter" } }, body: {} }),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 400, code: "validation_error", fields: ["phone"] });
  });

  it("turns a network failure into code network", async () => {
    mockApi({ "GET /api/v1/admin/me": () => Promise.reject(new TypeError("Failed to fetch")) });
    const err = await call(api.GET("/api/v1/admin/me")).catch((e) => e);
    expect(err).toMatchObject({ status: 0, code: "network" });
  });
});
