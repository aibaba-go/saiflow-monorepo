import { act, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useSessionNotice } from "../auth/session";
import { api as client, call } from "../services/api";
import { useLanguage } from "../stores/language";
import { useTenantChoice } from "../tenants/useCurrentTenant";
import { en, renderAt, signedIn, userEvent } from "../test/app";
import { GUEST, ORG, PERSONAL, UNREGISTERED, USER, type Me } from "../test/fixtures";
import { json, mockApi } from "../test/mockApi";

const USAGE = {
  plan: null,
  active: false,
  month: { month: "2026-11-01", quota: 0, used: 0, remaining: 0 },
  free: { remaining: 100, expires_at: null, paused: false },
};
const unauthenticated = () => json(401, { code: "unauthenticated" });
const page = (items: unknown[]) => json(200, { items, total: items.length, page: 1, page_size: 100 });

const GROUPS = [
  {
    key: "document",
    name: "Document",
    items: [
      { kind: "field", key: "invoice_no", name: "Invoice No.", type: "string", required: true },
      { kind: "field", key: "invoice_date", name: "Invoice date", type: "date", required: true },
      { kind: "field", key: "total", name: "Total", type: "amount" },
    ],
  },
];

const job = (by: number | null) => ({
  id: "A",
  file_id: "f-A",
  file_name: "A.png",
  page_count: 1,
  status: "SUCCEEDED",
  stage: "VERIFYING",
  error_code: null,
  engine: "textin",
  template_name: "Tax Invoice",
  created_at: "2026-11-07T01:00:00Z",
  confirmed_at: null,
  review_level: null,
  returned: false,
  created_by_user_id: by,
});

type Res = Record<string, unknown>;
const result = (structured: Res, over: Res = {}): Res => ({
  version: 1,
  structured,
  template: { template_version_id: 3, name: "Tax Invoice", groups: GROUPS },
  missing_required: [],
  mapping: null,
  match: null,
  warnings: [],
  amount_issues: [],
  confirmed: false,
  review: { stage: "NONE", required_level: null, records: [], last_return: null },
  ...over,
});

/** A backend whose identity is `who.me` (null: no session); a guest is created on request. */
function backend(who: { me: Me | null }, routes: Record<string, (r: Request) => Response | Promise<Response>> = {}) {
  return mockApi({
    "GET /api/v1/me": () => (who.me ? json(200, who.me) : unauthenticated()),
    "POST /api/v1/auth/guest": () => {
      who.me = GUEST;
      return json(200, GUEST);
    },
    "GET /api/v1/me/tenants": () => (who.me?.kind === "user" ? json(200, [PERSONAL]) : unauthenticated()),
    "GET /api/v1/me/notifications": () =>
      who.me?.kind === "user" ? json(200, { items: [], unread_count: 0, next_before: null }) : unauthenticated(),
    "GET /api/v1/billing/usage": () => json(200, USAGE),
    "GET /api/v1/ocr/jobs": () => page([]),
    "GET /api/v1/files/pending": () => json(200, []),
    ...routes,
  });
}

/** Task A to verify; confirming needs a user (a guest's confirm answers 401). */
function verifyBackend(who: { me: Me | null }, over: Record<string, (r: Request) => Response | Promise<Response>> = {}) {
  const state = { a: result({ document: { invoice_no: "IV-A", invoice_date: "2026-11-01", total: "100.00" } }), confirmed: false };
  const mine = () => (who.me?.kind === "user" ? 7 : null);
  const api = backend(who, {
    "GET /api/v1/ocr/jobs": () => page(state.confirmed ? [] : [job(mine())]),
    "GET /api/v1/ocr/jobs/A": () => json(200, { ...job(mine()), stage: state.confirmed ? "CONFIRMED" : "VERIFYING" }),
    "GET /api/v1/ocr/jobs/A/result": () => json(200, state.a),
    "GET /api/v1/ocr/jobs/A/changes": () => json(200, []),
    "GET /api/v1/files/f-A/pages/1/preview": () => new Response(new Blob(["x"], { type: "image/png" })),
    "PATCH /api/v1/ocr/jobs/A/result": async (r) => {
      const body = (await r.json()) as { structured: Res | null; confirm: boolean };
      if (body.confirm && who.me?.kind !== "user") return unauthenticated();
      state.a = result(body.structured ?? (state.a.structured as Res), {
        version: (state.a.version as number) + 1,
        confirmed: body.confirm,
        review: { stage: body.confirm ? "CONFIRMED" : "NONE", required_level: null, records: [], last_return: null },
      });
      if (body.confirm) state.confirmed = true;
      return json(200, state.a);
    },
    ...over,
  });
  return { api, state };
}

const field = (name: string) => screen.findByRole("textbox", { name });
const patches = async (api: ReturnType<typeof mockApi>) =>
  (await api.bodies("PATCH /api/v1/ocr/jobs/A/result")) as { confirm: boolean; structured: { document: { total: string } } | null }[];

async function loginWithPassword() {
  await userEvent.type(await screen.findByLabelText(en("login.email")), "somchai@example.com");
  await userEvent.type(screen.getByLabelText(en("login.password")), "secret123");
  await userEvent.click(screen.getByRole("button", { name: en("login.submit") }));
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useTenantChoice.getState().reset();
  useSessionNotice.getState().setExpired(false);
  useLanguage.getState().setLang("en");
});

describe("guests on web-pc (FR-SYS-090)", () => {
  it("a visitor uses Home and Upload as a guest with a guest menu (090-08)", async () => {
    const api = backend({ me: null });
    renderAt("/");
    expect(await screen.findByTestId("page-home")).toBeInTheDocument();
    const menu = screen.getByRole("menu");
    for (const k of ["nav.home", "nav.upload", "nav.verify"] as const) expect(within(menu).getByText(en(k))).toBeInTheDocument();
    for (const k of ["nav.library", "nav.plans", "nav.notifications", "nav.profile", "nav.templates"] as const) {
      expect(within(menu).queryByText(en(k))).not.toBeInTheDocument();
    }
    expect(screen.getByRole("link", { name: en("layout.login") })).toHaveAttribute("href", "/login?next=%2F");
    expect(screen.queryByRole("button", { name: en("tenant.switch") })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: en("my.logout") })).not.toBeInTheDocument();
    await userEvent.click(within(menu).getByText(en("nav.upload")));
    expect(await screen.findByTestId("page-upload")).toBeInTheDocument();
    expect(api.count("POST /api/v1/auth/guest")).toBe(1);
    expect(api.count("GET /api/v1/me/tenants")).toBe(0);
    expect(api.count("GET /api/v1/me/notifications")).toBe(0);
  });

  it("a guest opening the library sees the login page (090-09)", async () => {
    const api = backend({ me: GUEST });
    renderAt("/library");
    expect(await screen.findByRole("button", { name: en("login.button") })).toBeInTheDocument();
    expect(api.count("POST /api/v1/auth/guest")).toBe(0);
  });

  it("a guest whose session ended gets a new one and a notice (090-10)", async () => {
    const who: { me: Me | null } = { me: GUEST };
    const api = backend(who, { "GET /api/v1/billing/usage": () => (who.me ? json(200, USAGE) : unauthenticated()) });
    renderAt("/upload");
    await screen.findByTestId("page-upload");
    who.me = null;
    await act(() => call(client.GET("/api/v1/billing/usage")).catch(() => undefined));
    expect(await screen.findByText(en("err.guest_expired"))).toBeInTheDocument();
    await waitFor(() => expect(api.count("POST /api/v1/auth/guest")).toBe(1));
    expect(await screen.findByTestId("page-upload")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: en("login.button") })).not.toBeInTheDocument();
  });

  it("a user whose session ended goes to the login page, not a guest (090-11)", async () => {
    const backendApi = signedIn({ "GET /api/v1/billing/usage": () => json(200, USAGE), "GET /api/v1/ocr/jobs": () => page([]) });
    renderAt("/");
    await screen.findByText("Somchai");
    backendApi.set("GET /api/v1/me", unauthenticated);
    backendApi.set("GET /api/v1/billing/usage", unauthenticated);
    await act(() => call(client.GET("/api/v1/billing/usage")).catch(() => undefined));
    expect(await screen.findByText(en("err.session_expired"))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: en("login.button") })).toBeInTheDocument();
    expect(backendApi.count("POST /api/v1/auth/guest")).toBe(0);
  });
});

describe("guest confirm (FR-SYS-129)", () => {
  it("saves a draft, logs in and confirms in the personal tenant (129-14)", async () => {
    localStorage.setItem("saiflow.pc.tenant.7", "5"); // U last worked in an organization
    const who: { me: Me | null } = { me: GUEST };
    const { api } = verifyBackend(who, {
      "GET /api/v1/me/tenants": () => json(200, [PERSONAL, ORG]),
      "POST /api/v1/auth/password": () => {
        who.me = USER;
        return json(200, USER);
      },
    });
    renderAt("/verify/A");
    const total = await field("Total");
    await userEvent.clear(total);
    await userEvent.type(total, "1,234.50");
    await userEvent.click(screen.getByRole("button", { name: en("ocr.confirm") }));
    expect(await screen.findByRole("button", { name: en("login.button") })).toBeInTheDocument();
    const drafts = await patches(api);
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.confirm).toBe(false);
    expect(drafts[0]!.structured!.document.total).toBe("1234.50");

    await loginWithPassword();
    expect(await screen.findByText(en("ocr.confirmed"))).toBeInTheDocument();
    const all = await patches(api);
    expect(all).toHaveLength(2);
    expect(all[1]!.confirm).toBe(true);
    const confirm = api.calls.filter((c) => c.method === "PATCH").at(-1)!;
    expect(confirm.headers.get("X-Tenant-Id")).toBeNull();
    expect(screen.getByText("Somchai")).toBeInTheDocument();
  });

  it("an unregistered user registers first, then the task is confirmed (129-15)", async () => {
    const who: { me: Me | null } = { me: GUEST };
    const { api } = verifyBackend(who, {
      "POST /api/v1/auth/password": () => {
        who.me = UNREGISTERED;
        return json(200, UNREGISTERED);
      },
    });
    renderAt("/verify/A");
    await field("Total");
    await userEvent.click(screen.getByRole("button", { name: en("ocr.confirm") }));
    await loginWithPassword();
    expect(await screen.findByText(en("guide.title"))).toBeInTheDocument();
    expect((await patches(api)).filter((b) => b.confirm)).toHaveLength(0);
    who.me = USER;
    await userEvent.click(screen.getByRole("button", { name: en("guide.done") }));
    expect(await screen.findByText(en("ocr.confirmed"))).toBeInTheDocument();
    expect((await patches(api)).filter((b) => b.confirm)).toHaveLength(1);
  });

  it("a refused automatic confirm marks the field and is not repeated (129-16)", async () => {
    sessionStorage.setItem("saiflow.confirm-after-login.A", "1");
    const who: { me: Me | null } = { me: USER };
    const { api } = verifyBackend(who, {
      "PATCH /api/v1/ocr/jobs/A/result": () => json(422, { code: "required_missing", fields: ["structured.document.invoice_date"] }),
    });
    const first = renderAt("/verify/A");
    await waitFor(() => expect(api.count("PATCH /api/v1/ocr/jobs/A/result")).toBe(1));
    expect(sessionStorage.getItem("saiflow.confirm-after-login.A")).toBeNull();
    expect(screen.queryByText(en("ocr.confirmed"))).not.toBeInTheDocument();
    first.unmount();
    renderAt("/verify/A");
    await field("Total");
    expect(api.count("PATCH /api/v1/ocr/jobs/A/result")).toBe(1);
  });

  it("a user's confirm is unchanged: no login, no remembered task", async () => {
    const who: { me: Me | null } = { me: USER };
    const { api } = verifyBackend(who);
    renderAt("/verify/A");
    await field("Total");
    await userEvent.click(screen.getByRole("button", { name: en("ocr.confirm") }));
    expect(await screen.findByText(en("ocr.confirmed"))).toBeInTheDocument();
    expect((await patches(api)).map((b) => b.confirm)).toEqual([true]);
    expect(sessionStorage.getItem("saiflow.confirm-after-login.A")).toBeNull();
  });
});
