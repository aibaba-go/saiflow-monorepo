import { screen, waitFor, within } from "@testing-library/react";
import { focusManager } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLanguage } from "../stores/language";
import { en, renderAt, signedIn, userEvent } from "../test/app";
import { ORG, PERSONAL } from "../test/fixtures";
import { json } from "../test/mockApi";
import { useTenantChoice } from "../tenants/useCurrentTenant";

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

const job = (id: string, returned = false) => ({
  id,
  file_id: `f-${id}`,
  file_name: `${id}.png`,
  page_count: 1,
  status: "SUCCEEDED",
  stage: "VERIFYING",
  error_code: null,
  engine: "textin",
  template_name: "Tax Invoice",
  created_at: "2026-11-07T01:00:00Z",
  confirmed_at: null,
  review_level: null,
  returned,
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

const doc = (no: string) => ({ document: { invoice_no: no, invoice_date: "2026-11-01", total: "100.00" } });

/** Two tasks to verify, A and B; PATCH on A confirms it (removing it from the list). */
function verifyApi(over: Record<string, (r: Request) => Response | Promise<Response>> = {}) {
  const state = { list: [job("A"), job("B")], results: { A: result(doc("IV-A")), B: result(doc("IV-B")) } as Record<string, Res> };
  const routes: Record<string, (r: Request) => Response | Promise<Response>> = {
    "GET /api/v1/ocr/jobs": () => json(200, { items: state.list, total: state.list.length, page: 1, page_size: 100 }),
    "GET /api/v1/ocr/jobs/A": () => json(200, state.list.find((j) => j.id === "A") ?? { ...job("A"), stage: "CONFIRMED" }),
    "GET /api/v1/ocr/jobs/B": () => json(200, job("B")),
    "GET /api/v1/ocr/jobs/A/result": () => json(200, state.results.A),
    "GET /api/v1/ocr/jobs/B/result": () => json(200, state.results.B),
    "GET /api/v1/ocr/jobs/A/changes": () => json(200, []),
    "GET /api/v1/ocr/jobs/B/changes": () => json(200, []),
    "GET /api/v1/files/f-A/pages/1/preview": () => new Response(new Blob(["x"], { type: "image/png" })),
    "GET /api/v1/files/f-B/pages/1/preview": () => new Response(new Blob(["x"], { type: "image/png" })),
    "PATCH /api/v1/ocr/jobs/A/result": async (r) => {
      const body = (await r.json()) as { structured: Res; confirm: boolean };
      const confirmed = body.confirm;
      state.results.A = result(body.structured ?? (state.results.A!.structured as Res), {
        version: 2,
        confirmed,
        review: { stage: confirmed ? "CONFIRMED" : "NONE", required_level: null, records: [], last_return: null },
      });
      if (confirmed) state.list = state.list.filter((j) => j.id !== "A");
      return json(200, state.results.A);
    },
    "GET /api/v1/ocr/jobs/A/template-options": () =>
      json(200, { templates: [], generic: true, current_template_version_id: 3, attempts: 0, limit: 5, last_failure: null }),
    "POST /api/v1/ocr/jobs/A/generic": () => {
      state.results.A = result({ header: { seller: "S" } }, { version: 3, template: null });
      return json(200, { result: "switched", mapping_id: null });
    },
    ...over,
  };
  return { state, api: signedIn(routes) };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useTenantChoice.getState().reset();
  useLanguage.getState().setLang("en");
});

const field = (name: string) => screen.findByRole("textbox", { name });

describe("verify (FR-SYS-129)", () => {
  it("edit and confirm opens the next (129-01)", async () => {
    const { api } = verifyApi();
    renderAt("/verify/A");
    const total = await field("Total");
    await userEvent.clear(total);
    await userEvent.type(total, "1,234.50");
    await userEvent.click(screen.getByRole("button", { name: en("ocr.confirm") }));
    expect(await screen.findByText(en("ocr.confirmed"))).toBeInTheDocument();
    await waitFor(async () => expect(((await field("Invoice No.")) as HTMLInputElement).value).toBe("IV-B"));
    const bodies = (await api.bodies("PATCH /api/v1/ocr/jobs/A/result")) as { confirm: boolean; structured: { document: { total: string } } }[];
    // the edits are saved as a draft first, then confirmed (final review 2)
    expect(bodies[0]!.confirm).toBe(false);
    expect(bodies[0]!.structured.document.total).toBe("1234.50");
    expect(bodies.at(-1)!.confirm).toBe(true);
  });

  it("asks before switching or leaving with unsaved edits (129-02, Review Focus 1)", async () => {
    verifyApi();
    renderAt("/verify/A");
    const no = await field("Invoice No.");
    await userEvent.type(no, "X");
    const list = screen.getByTestId("verify-queue");
    await userEvent.click(within(list).getByText("B.png"));
    const dialog = await screen.findByRole("dialog", { name: en("ocr.leaveTitle") });
    await userEvent.click(within(dialog).getByRole("button", { name: en("common.cancel") }));
    expect(((await field("Invoice No.")) as HTMLInputElement).value).toBe("IV-AX");
    await userEvent.click(within(screen.getByRole("menu")).getByText(en("nav.notifications")));
    expect(await screen.findByRole("dialog", { name: en("ocr.leaveTitle") })).toBeInTheDocument();
  });

  it("missing required marks and scrolls (129-03)", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    verifyApi({
      "PATCH /api/v1/ocr/jobs/A/result": () => json(422, { code: "required_missing", fields: ["structured.document.invoice_date"] }),
    });
    renderAt("/verify/A");
    await field("Invoice No.");
    await userEvent.click(screen.getByRole("button", { name: en("ocr.confirm") }));
    await waitFor(() => {
      const box = document.querySelector('[data-path="document.invoice_date"]') as HTMLElement;
      expect(box.className).toContain("required-missing");
    });
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    expect(within(screen.getByTestId("verify-queue")).getByText("A.png")).toBeInTheDocument();
  });

  it("change to generic saves draft first (129-04)", async () => {
    const { api } = verifyApi();
    renderAt("/verify/A");
    await userEvent.type(await field("Invoice No."), "Z");
    await userEvent.click(screen.getByRole("button", { name: en("ocr.changeTemplate") }));
    const dialog = await screen.findByRole("dialog", { name: en("ocr.changeTemplate") });
    await userEvent.click(await within(dialog).findByText(en("review.generic")));
    await waitFor(() => expect(api.count("POST /api/v1/ocr/jobs/A/generic")).toBe(1));
    const patches = (await api.bodies("PATCH /api/v1/ocr/jobs/A/result")) as { confirm: boolean }[];
    expect(patches).toHaveLength(1);
    expect(patches[0]!.confirm).toBe(false);
    expect(await screen.findByRole("button", { name: en("ocr.addField") })).toBeInTheDocument();
  });

  it("returned task shows the banner (129-05)", async () => {
    const back = { round_no: 1, level: 1, decision: "RETURN", comment: "税额不对", reviewer_name: "Ratana", created_at: "2026-11-07T03:00:00Z" };
    const { state } = verifyApi();
    state.list = [job("A", true), job("B")];
    state.results.A = result(doc("IV-A"), { review: { stage: "NONE", required_level: null, records: [back], last_return: back } });
    renderAt("/verify/A");
    const list = await screen.findByTestId("verify-queue");
    expect(await within(list).findByText(en("ocr.returned"))).toBeInTheDocument();
    const banner = await screen.findByTestId("return-banner");
    expect(banner).toHaveTextContent("Ratana");
    expect(banner).toHaveTextContent("税额不对");
  });

  it("next task starts clean (Review Focus 2)", async () => {
    verifyApi();
    renderAt("/verify/A");
    await userEvent.type(await field("Invoice No."), "9");
    await userEvent.click(screen.getByRole("button", { name: en("ocr.confirm") }));
    await screen.findByText(en("ocr.confirmed"));
    await waitFor(async () => expect(((await field("Invoice No.")) as HTMLInputElement).value).toBe("IV-B"));
    expect(screen.queryByRole("dialog", { name: en("ocr.leaveTitle") })).not.toBeInTheDocument();
  });

  it("tenant switch clears the open task (Review Focus 3)", async () => {
    localStorage.setItem("saiflow.pc.tenant.7", "70");
    useTenantChoice.getState().reset();
    signedIn(
      {
        "GET /api/v1/ocr/jobs": (r) =>
          json(200, r.headers.get("X-Tenant-Id") === "5"
            ? { items: [], total: 0, page: 1, page_size: 100 }
            : { items: [job("A")], total: 1, page: 1, page_size: 100 }),
        "GET /api/v1/ocr/jobs/A": () => json(200, job("A")),
        "GET /api/v1/ocr/jobs/A/result": () => json(200, result(doc("IV-A"))),
        "GET /api/v1/files/f-A/pages/1/preview": () => new Response(new Blob(["x"])),
      },
      { tenants: [PERSONAL, { ...ORG, permissions: ["verify_own"] }] },
    );
    renderAt("/verify/A");
    await field("Invoice No.");
    await userEvent.click(screen.getByRole("button", { name: en("tenant.switch") }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Siam Tools" }));
    expect((await screen.findAllByText(en("ocr.noneToVerify"))).length).toBeGreaterThan(0);
    expect(screen.queryByRole("textbox", { name: "Invoice No." })).not.toBeInTheDocument();
  });

  it("plan expired saves the draft first and shows plans link (final review 2)", async () => {
    const { api } = verifyApi({
      "PATCH /api/v1/ocr/jobs/A/result": async (r) => {
        const body = (await r.json()) as { confirm: boolean; structured: Res | null };
        if (body.confirm) return json(402, { code: "plan_expired" });
        return json(200, result(body.structured ?? doc("IV-A"), { version: 2 }));
      },
    });
    renderAt("/verify/A");
    await userEvent.type(await field("Invoice No."), "7");
    await userEvent.click(screen.getByRole("button", { name: en("ocr.confirm") }));
    await waitFor(async () => expect((await api.bodies("PATCH /api/v1/ocr/jobs/A/result")).length).toBe(2));
    const [draft, confirm] = (await api.bodies("PATCH /api/v1/ocr/jobs/A/result")) as {
      confirm: boolean;
      expected_version: number;
      structured: { document: { invoice_no: string } } | null;
    }[];
    expect(draft!.confirm).toBe(false);
    expect(draft!.structured!.document.invoice_no).toBe("IV-A7");
    expect(confirm!.confirm).toBe(true);
    expect(confirm!.expected_version).toBe(2);
    const alert = (await screen.findByText(en("err.plan_expired"))).closest(".ant-alert") as HTMLElement;
    expect(within(alert).getByRole("link", { name: en("nav.plans") })).toHaveAttribute("href", "/plans");
  });

  it("save sends the version the edit was based on (final review 1)", async () => {
    const { api, state } = verifyApi();
    renderAt("/verify/A");
    await userEvent.type(await field("Invoice No."), "1");
    // a colleague saves meanwhile; the page refetches and now knows version 5
    state.results.A = { ...state.results.A!, version: 5 };
    focusManager.setFocused(false);
    focusManager.setFocused(true);
    await waitFor(() => expect(api.count("GET /api/v1/ocr/jobs/A/result")).toBeGreaterThan(1));
    await userEvent.click(screen.getByRole("button", { name: en("ocr.saveDraft") }));
    await waitFor(async () => expect((await api.bodies("PATCH /api/v1/ocr/jobs/A/result")).length).toBe(1));
    const [body] = (await api.bodies("PATCH /api/v1/ocr/jobs/A/result")) as { expected_version: number }[];
    expect(body!.expected_version).toBe(1);
  });

  it("tenant switch with unsaved edits asks first (final review 5)", async () => {
    verifyApi();
    renderAt("/verify/A");
    await userEvent.type(await field("Invoice No."), "X");
    await userEvent.click(screen.getByRole("button", { name: en("tenant.switch") }));
    const items = await screen.findAllByRole("menuitem");
    await userEvent.click(items[items.length - 1]!);
    const dialog = await screen.findByRole("dialog", { name: en("ocr.leaveTitle") });
    await userEvent.click(within(dialog).getByRole("button", { name: en("common.cancel") }));
    expect(((await field("Invoice No.")) as HTMLInputElement).value).toBe("IV-AX");
  });

  it("version conflict reloads", async () => {
    const { api } = verifyApi({ "PATCH /api/v1/ocr/jobs/A/result": () => json(409, { code: "version_conflict" }) });
    renderAt("/verify/A");
    await userEvent.type(await field("Invoice No."), "Q");
    await userEvent.click(screen.getByRole("button", { name: en("ocr.saveDraft") }));
    expect(await screen.findByText(en("ocr.changedByOthers"))).toBeInTheDocument();
    await waitFor(() => expect(api.count("GET /api/v1/ocr/jobs/A/result")).toBeGreaterThan(1));
  });
});
