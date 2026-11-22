import userEventLib from "@testing-library/user-event";

import { AppRoutes } from "../App";
import { translate, type MessageKey, type Vars } from "../i18n";
import { json, mockApi } from "./mockApi";
import { renderWithProviders } from "./render";

export const userEvent = userEventLib.setup({ pointerEventsCheck: 0 });

/** The Chinese text of a key: tests run in the default language. */
export const zh = (key: MessageKey, vars?: Vars) => translate("zh", key, vars);

type Handler = Parameters<typeof mockApi>[0][string];

/** Stub the backend with a signed-in admin "ops" plus these routes. */
export function signedIn(routes: Record<string, Handler>) {
  return mockApi({
    "GET /api/v1/admin/me": () => json(200, { admin_id: 1, username: "ops" }),
    "GET /api/v1/admin/data-sources": () => json(200, { items: [] }),
    ...routes,
  });
}

/** The whole console at this URL. */
export function renderAt(route: string) {
  return renderWithProviders(<AppRoutes />, { route });
}
