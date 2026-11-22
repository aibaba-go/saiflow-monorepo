import userEventLib from "@testing-library/user-event";

import { AppRoutes } from "../App";
import { translate, type MessageKey, type Vars } from "../i18n";
import { USER, PERSONAL, type Me, type UsableTenant } from "./fixtures";
import { json, mockApi } from "./mockApi";
import { renderWithProviders } from "./render";

export const userEvent = userEventLib.setup({ pointerEventsCheck: 0 });

/** The English text of a key: tests run in the default language unless they switch. */
export const en = (key: MessageKey, vars?: Vars) => translate("en", key, vars);

type Handler = Parameters<typeof mockApi>[0][string];

export const dashboard = (kind: "personal" | "organization") => ({
  kind, generated_at: "2026-11-22T00:00:00Z",
  counts: { VERIFYING: 0, OCR_PROCESSING: 0, PENDING_REVIEW: 0, CONFIRMED: 0 },
  usage: { plan_code: "starter", ends_at: "2026-12-01T00:00:00Z", quota: 5000, used: 0, remaining: 5000, free_remaining: 0, free_expires_at: null, free_paused: false, plan_active: true },
  recent: [],
  config: { version: 2, grid: { cols: 12, row_height: 80 }, cards: [
    ...["VERIFYING", "OCR_PROCESSING", "PENDING_REVIEW", "CONFIRMED"].map((id, i) => ({ id, type: "metric", layout: { x: i * 3, y: 0, w: 3, h: 2 } })),
    { id: "progress", type: "bar", layout: { x: 0, y: 2, w: kind === "personal" ? 5 : 7, h: 4 } },
    { id: "usage", type: "metric", layout: { x: kind === "personal" ? 5 : 7, y: 2, w: kind === "personal" ? 7 : 5, h: 4 } },
    { id: "recent", type: "table", layout: { x: 0, y: 6, w: 12, h: 4 } },
  ] },
});

/** Stub the backend with a signed-in user (and their tenants) plus these routes. */
export function signedIn(
  routes: Record<string, Handler> = {},
  { me = USER, tenants = [PERSONAL] }: { me?: Me; tenants?: UsableTenant[] } = {},
) {
  return mockApi({
    "GET /api/v1/me": () => json(200, me),
    "GET /api/v1/me/tenants": () => json(200, tenants),
    "GET /api/v1/me/homepage": (r) => json(200, { report_id: null, default: r.headers.get("X-Tenant-Id") ? "organization" : "personal" }),
    "GET /api/v1/me/dashboard": (r) => json(200, dashboard(r.headers.get("X-Tenant-Id") ? "organization" : "personal")),
    "GET /api/v1/data-sources": () => json(200, { items: [] }),
    "GET /api/v1/me/notifications": () => json(200, { items: [], unread_count: 0, next_before: null }),
    ...routes,
  });
}

/** The whole app at this URL. */
export function renderAt(route: string) {
  return renderWithProviders(<AppRoutes />, { route });
}
