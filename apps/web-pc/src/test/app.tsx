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

/** Stub the backend with a signed-in user (and their tenants) plus these routes. */
export function signedIn(
  routes: Record<string, Handler> = {},
  { me = USER, tenants = [PERSONAL] }: { me?: Me; tenants?: UsableTenant[] } = {},
) {
  return mockApi({
    "GET /api/v1/me": () => json(200, me),
    "GET /api/v1/me/tenants": () => json(200, tenants),
    "GET /api/v1/me/notifications": () => json(200, { items: [], unread_count: 0, next_before: null }),
    ...routes,
  });
}

/** The whole app at this URL. */
export function renderAt(route: string) {
  return renderWithProviders(<AppRoutes />, { route });
}
