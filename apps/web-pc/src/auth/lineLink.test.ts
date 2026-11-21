import { beforeEach, expect, it, vi } from "vitest";

import { external, LOGIN_STATE_KEY, startLineLogin, takeLoginState } from "./lineLogin";

beforeEach(() => {
  sessionStorage.clear();
  vi.spyOn(external, "assign").mockImplementation(() => {});
});

it("keeps an explicit linking purpose with one-use OAuth state, but no credentials", () => {
  startLineLogin("/profile", "link");
  const saved = JSON.parse(sessionStorage.getItem(LOGIN_STATE_KEY)!);
  expect(saved).toMatchObject({ next: "/profile", mode: "link" });
  expect(Object.keys(saved).sort()).toEqual(["at", "mode", "next", "state"]);
  expect(takeLoginState(saved.state)).toEqual({ ok: true, next: "/profile", mode: "link" });
  expect(takeLoginState(saved.state)).toEqual({ ok: false });
});
