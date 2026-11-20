import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryRouter, RouterProvider } from "react-router-dom";

import { AppRoutes } from "../App";
import { useLanguage } from "../stores/language";
import { useTenantChoice } from "../tenants/useCurrentTenant";
import { en, renderAt, signedIn, userEvent } from "../test/app";
import { USER } from "../test/fixtures";
import { json, mockApi } from "../test/mockApi";

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useLanguage.getState().setLang("en");
  useTenantChoice.getState().reset();
});

const AS_USER = { ...USER, impersonated: true };

/** The app at `route`, keeping the router so the address can be checked. */
function open(route: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter([{ path: "*", element: <AppRoutes /> }], { initialEntries: [route] });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const routes = (redeem: () => Response) => {
  let me: unknown = null;
  return mockApi({
    "GET /api/v1/me": () => (me ? json(200, me) : json(401, { code: "unauthenticated" })),
    "GET /api/v1/me/tenants": () => json(200, [{ tenant_id: 70, kind: "personal", name: null, is_owner: true, role: null, permissions: [] }]),
    "GET /api/v1/me/homepage": () => json(200, { report_id: null, default: "personal" }),
    "GET /api/v1/me/notifications": () => json(200, { items: [], unread_count: 0, next_before: null }),
    "POST /api/v1/auth/impersonation": () => {
      const res = redeem();
      if (res.status === 200) me = AS_USER;
      return res;
    },
    "POST /api/v1/auth/logout": () => {
      me = null;
      return json(204, null);
    },
  });
};

describe("log in as a user (FR-SYS-147)", () => {
  it("drops the ticket from the address, redeems it once and lands home with the banner (147-01)", async () => {
    const api = routes(() => json(200, AS_USER));
    const router = open("/impersonate#tk-123");
    expect(await screen.findByTestId("page-home")).toBeInTheDocument();
    expect(router.state.location.pathname).toBe("/");
    expect(router.state.location.hash).toBe("");
    expect(await api.bodies("POST /api/v1/auth/impersonation")).toEqual([{ ticket: "tk-123" }]);
    expect(screen.getByRole("status")).toHaveTextContent(en("impersonate.banner", { name: "Somchai" }));
    expect(router.state.historyAction).toBe("REPLACE");
  });

  it("a used or expired link, or none, says so and offers the login page (147-02)", async () => {
    const api = routes(() => json(401, { code: "impersonation_invalid" }));
    const router = open("/impersonate#used");
    expect(await screen.findByText(en("impersonate.invalid"))).toBeInTheDocument();
    expect(router.state.location.hash).toBe("");
    expect(api.count("POST /api/v1/auth/impersonation")).toBe(1);
    await userEvent.click(screen.getByRole("link", { name: en("impersonate.toLogin") }));
    expect(await screen.findByRole("button", { name: en("login.button") })).toBeInTheDocument();
  });

  it("without a ticket nothing is sent (147-02)", async () => {
    const api = routes(() => json(200, AS_USER));
    open("/impersonate");
    expect(await screen.findByText(en("impersonate.invalid"))).toBeInTheDocument();
    expect(api.count("POST /api/v1/auth/impersonation")).toBe(0);
  });

  it("ending it logs out to the login page (147-03)", async () => {
    const api = routes(() => json(200, AS_USER));
    open("/impersonate#tk-123");
    await userEvent.click(await screen.findByRole("button", { name: en("impersonate.end") }));
    expect(await screen.findByRole("button", { name: en("login.button") })).toBeInTheDocument();
    expect(api.count("POST /api/v1/auth/logout")).toBe(1);
  });

  it("a normal session has no banner (147-03)", async () => {
    signedIn();
    renderAt("/");
    expect(await screen.findByTestId("page-home")).toBeInTheDocument();
    await waitFor(() => expect(screen.getByText("Somchai")).toBeInTheDocument());
    expect(screen.queryByText(en("impersonate.end"))).not.toBeInTheDocument();
  });
});
