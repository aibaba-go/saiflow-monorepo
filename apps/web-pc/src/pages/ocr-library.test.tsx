import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLanguage } from "../stores/language";
import { en, renderAt, signedIn, userEvent } from "../test/app";
import { ORG, PERSONAL } from "../test/fixtures";
import { json } from "../test/mockApi";
import { useTenantChoice } from "../tenants/useCurrentTenant";

const job = (n: number | string, stage = "CONFIRMED", extra: Record<string, unknown> = {}) => ({
  id: `j${n}`,
  file_id: `f${n}`,
  file_name: `doc-${n}.png`,
  page_count: 1,
  status: "SUCCEEDED",
  stage,
  error_code: null,
  engine: "textin",
  template_name: "Tax Invoice",
  created_at: "2026-11-07T01:00:00Z",
  confirmed_at: stage === "CONFIRMED" ? "2026-11-07T02:00:00Z" : null,
  review_level: null,
  returned: false,
  ...extra,
});

const TEMPLATES = [
  { template_id: 7, name: "Tax Invoice" },
  { template_id: 8, name: "Billing Note" },
];

const result = (over: Record<string, unknown> = {}) => ({
  version: 2,
  structured: { document: { invoice_no: "IV1" } },
  template: {
    template_version_id: 3,
    name: "Tax Invoice",
    groups: [{ key: "document", name: "Document", items: [{ kind: "field", key: "invoice_no", name: "Invoice No.", type: "string" }] }],
  },
  missing_required: [],
  mapping: null,
  confirmed: true,
  review: { stage: "CONFIRMED", required_level: null, records: [], last_return: null },
  ...over,
});

function inOrg(perms: string[], owner = false) {
  localStorage.setItem("saiflow.pc.tenant.7", "5");
  useTenantChoice.getState().reset();
  return { tenants: [PERSONAL, { ...ORG, is_owner: owner, permissions: perms }] };
}

const queryOf = (r: Request) => Object.fromEntries(new URL(r.url).searchParams.entries());

async function pick(label: string, option: string) {
  const select = screen.getByRole("combobox", { name: label });
  await userEvent.click(select);
  const opts = await screen.findAllByTitle(option);
  await userEvent.click(opts[opts.length - 1]!);
}

/** The stage filter is a tab row with real counts (prototype library tabs). */
async function pickStage(stage: "CONFIRMED") {
  const tabs = screen.getByRole("tablist", { name: en("library.stage") });
  await userEvent.click(within(tabs).getByRole("tab", { name: new RegExp(`^${en(`stage.${stage}`)}`) }));
}

/** The list calls of the table (20 a page), not the one-row stage counts of the tabs. */
const listCalls = <T extends Record<string, string>>(seen: T[]) => seen.filter((q) => q.page_size === "20");

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useTenantChoice.getState().reset();
  useLanguage.getState().setLang("en");
});

describe("library (FR-SYS-130)", () => {
  it("combined filters and paging (130-01)", async () => {
    const all = Array.from({ length: 25 }, (_, i) => job(i + 1));
    const seen: Record<string, string>[] = [];
    signedIn({
      "GET /api/v1/templates": () => json(200, TEMPLATES),
      "GET /api/v1/ocr/jobs": (r) => {
        const q = queryOf(r);
        seen.push(q);
        const filtered = q.stage === "CONFIRMED" && q.template === "7" ? all : [];
        const page = Number(q.page);
        return json(200, { items: filtered.slice((page - 1) * 20, page * 20), total: filtered.length, page, page_size: 20 });
      },
    });
    renderAt("/library");
    await screen.findByTestId("page-library");
    await pickStage("CONFIRMED");
    await pick(en("library.template"), "Tax Invoice");
    expect(await screen.findByText("doc-20.png")).toBeInTheDocument();
    await userEvent.click(screen.getByTitle("2"));
    expect(await screen.findByText("doc-25.png")).toBeInTheDocument();
    expect(listCalls(seen).at(-1)).toMatchObject({ stage: "CONFIRMED", template: "7", page: "2", page_size: "20" });
  });

  it("open by stage (130-02)", async () => {
    signedIn({
      "GET /api/v1/templates": () => json(200, TEMPLATES),
      "GET /api/v1/ocr/jobs": () => json(200, { items: [job("A", "VERIFYING"), job("B")], total: 2, page: 1, page_size: 20 }),
      "GET /api/v1/ocr/jobs/jB": () => json(200, job("B")),
      "GET /api/v1/ocr/jobs/jB/result": () => json(200, result()),
      "GET /api/v1/ocr/jobs/jB/changes": () => json(200, []),
      "GET /api/v1/files/fB/pages/1/preview": () => new Response(new Blob(["x"])),
    });
    renderAt("/library");
    await userEvent.click(await screen.findByText("doc-B.png"));
    expect(await screen.findByTestId("page-document")).toBeInTheDocument();
    expect(await screen.findByText("IV1")).toBeInTheDocument();
  });

  it("member without data browse sees what the API returns (130-03)", async () => {
    const seen: Record<string, string>[] = [];
    signedIn(
      {
        "GET /api/v1/templates": () => json(200, TEMPLATES),
        "GET /api/v1/ocr/jobs": (r) => {
          seen.push(queryOf(r));
          return json(200, { items: [job("mine")], total: 1, page: 1, page_size: 20 });
        },
      },
      inOrg(["upload_ocr", "verify_own"]),
    );
    renderAt("/library");
    expect(await screen.findByText("doc-mine.png")).toBeInTheDocument();
    expect(Object.keys(listCalls(seen)[0]!).sort()).toEqual(["page", "page_size"]);
  });

  it("tenant switch resets filters (Review Focus 3)", async () => {
    const seen: { tenant: string | null; q: Record<string, string> }[] = [];
    signedIn(
      {
        "GET /api/v1/templates": () => json(200, TEMPLATES),
        "GET /api/v1/ocr/jobs": (r) => {
          seen.push({ tenant: r.headers.get("X-Tenant-Id"), q: queryOf(r) });
          return json(200, { items: [], total: 0, page: 1, page_size: 20 });
        },
      },
      { tenants: [PERSONAL, ORG] },
    );
    renderAt("/library");
    await screen.findByTestId("page-library");
    await pickStage("CONFIRMED");
    const lists = () => seen.filter((s) => s.q.page_size === "20");
    await waitFor(() => expect(lists().at(-1)!.q.stage).toBe("CONFIRMED"));
    await userEvent.click(screen.getByRole("button", { name: en("tenant.switch") }));
    await userEvent.click(await screen.findByRole("menuitem", { name: "Siam Tools" }));
    await waitFor(() => expect(lists().at(-1)!.tenant).toBe("5"));
    expect(lists().at(-1)!.q.stage).toBeUndefined();
  });

  it("no verify permission opens detail (Review Focus 5)", async () => {
    signedIn(
      {
        "GET /api/v1/templates": () => json(200, TEMPLATES),
        "GET /api/v1/ocr/jobs": () => json(200, { items: [job("A", "VERIFYING")], total: 1, page: 1, page_size: 20 }),
        "GET /api/v1/ocr/jobs/jA": () => json(200, job("A", "VERIFYING")),
        "GET /api/v1/ocr/jobs/jA/result": () => json(200, result({ confirmed: false, review: { stage: "NONE", required_level: null, records: [], last_return: null } })),
        "GET /api/v1/ocr/jobs/jA/changes": () => json(200, []),
        "GET /api/v1/files/fA/pages/1/preview": () => new Response(new Blob(["x"])),
      },
      inOrg(["data_browse"]),
    );
    renderAt("/library");
    await userEvent.click(await screen.findByText("doc-A.png"));
    expect(await screen.findByTestId("page-document")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: en("ocr.goVerify") })).not.toBeInTheDocument();
  });

  it("a colleague's job without verify_others opens the detail (final review 3)", async () => {
    signedIn(
      {
        "GET /api/v1/templates": () => json(200, TEMPLATES),
        "GET /api/v1/ocr/jobs": () =>
          json(200, {
            items: [job("C", "VERIFYING", { created_by_user_id: 8 }), job("M", "VERIFYING", { created_by_user_id: 7 })],
            total: 2,
            page: 1,
            page_size: 20,
          }),
        "GET /api/v1/ocr/jobs/jC": () => json(200, job("C", "VERIFYING", { created_by_user_id: 8 })),
        "GET /api/v1/ocr/jobs/jC/result": () =>
          json(200, result({ confirmed: false, review: { stage: "NONE", required_level: null, records: [], last_return: null } })),
        "GET /api/v1/ocr/jobs/jC/changes": () => json(200, []),
        "GET /api/v1/files/fC/pages/1/preview": () => new Response(new Blob(["x"])),
      },
      inOrg(["upload_ocr", "verify_own", "data_browse"]),
    );
    renderAt("/library");
    await userEvent.click(await screen.findByText("doc-C.png"));
    expect(await screen.findByTestId("page-document")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: en("ocr.goVerify") })).not.toBeInTheDocument();
    // the verify page lists only jobs this user may edit
    await userEvent.click(within(screen.getByRole("menu")).getByText(en("nav.verify")));
    const queue = await screen.findByTestId("verify-queue");
    await within(queue).findByText("doc-M.png");
    expect(within(queue).queryByText("doc-C.png")).not.toBeInTheDocument();
  });

  it("menu has no data browse (094-03)", async () => {
    signedIn({ "GET /api/v1/templates": () => json(200, TEMPLATES), "GET /api/v1/ocr/jobs": () => json(200, { items: [], total: 0, page: 1, page_size: 20 }) });
    renderAt("/data");
    expect(await screen.findByTestId("page-library")).toBeInTheDocument();
    expect(screen.queryByText(en("common.comingSoon"))).not.toBeInTheDocument();
  });
});

describe("document detail (FR-SYS-131)", () => {
  it("renders a generic top-level detail array as a read-only table (FR-SYS-131, FR-SYS-105)", async () => {
    signedIn({
      "GET /api/v1/ocr/jobs/j1": () => json(200, job(1, "CONFIRMED", { template_name: null })),
      "GET /api/v1/ocr/jobs/j1/result": () => json(200, result({
        template: null,
        structured: {
          bank_name: "Test Bank",
          grand_total: "250.00",
          transactions: [
            { amount: "100.00", description: "First purchase", transaction_date: "01/01/2025" },
            { amount: "150.00", description: "Second purchase", transaction_date: "02/01/2025" },
          ],
        },
      })),
      "GET /api/v1/ocr/jobs/j1/changes": () => json(200, []),
      "GET /api/v1/files/f1/pages/1/preview": () => new Response(new Blob(["x"])),
    });
    renderAt("/documents/j1");
    const page = await screen.findByTestId("page-document");
    const cell = await within(page).findByRole("cell", { name: "First purchase" });
    const table = cell.closest("table")!;
    expect(within(table).getAllByRole("columnheader").map((cell) => cell.textContent)).toEqual(["amount", "description", "transaction_date"]);
    expect(within(table).getAllByRole("row")).toHaveLength(3);
    expect(within(table).getByRole("cell", { name: "100.00" })).toBeInTheDocument();
    expect(within(table).getByRole("cell", { name: "Second purchase" })).toBeInTheDocument();
    expect(within(page).getByText("Test Bank")).toBeInTheDocument();
    expect(within(page).queryByRole("textbox")).not.toBeInTheDocument();
    expect(within(page).queryByText(/\{"amount":/)).not.toBeInTheDocument();
  });

  it("export downloads xlsx (131-01)", async () => {
    const created = vi.fn(() => "blob:x");
    URL.createObjectURL = created as never;
    URL.revokeObjectURL = vi.fn();
    const api = signedIn({
      "GET /api/v1/ocr/jobs/j1": () => json(200, job(1)),
      "GET /api/v1/ocr/jobs/j1/result": () => json(200, result()),
      "GET /api/v1/ocr/jobs/j1/changes": () => json(200, []),
      "GET /api/v1/files/f1/pages/1/preview": () => new Response(new Blob(["x"])),
      "POST /api/v1/ocr/jobs/j1/exports": () => json(201, { id: "e1", status: "READY" }),
      "GET /api/v1/exports/e1/download": () => new Response(new Blob(["xlsx"])),
    });
    useLanguage.getState().setLang("th");
    renderAt("/documents/j1");
    await userEvent.click(await screen.findByRole("button", { name: /Excel/ }));
    await waitFor(() => expect(api.count("GET /api/v1/exports/e1/download")).toBe(1));
    expect(await api.bodies("POST /api/v1/ocr/jobs/j1/exports")).toEqual([{ language: "th" }]);
    expect(created).toHaveBeenCalled();
  });

  it("pending review hides export (131-02)", async () => {
    const ok = { round_no: 1, level: 1, decision: "APPROVE", comment: "OK", reviewer_name: "R1", created_at: "2026-11-07T03:00:00Z" };
    signedIn({
      "GET /api/v1/ocr/jobs/j1": () => json(200, job(1, "PENDING_REVIEW", { review_level: 2 })),
      "GET /api/v1/ocr/jobs/j1/result": () => json(200, result({ review: { stage: "PENDING_L2", required_level: 2, records: [ok], last_return: null } })),
      "GET /api/v1/ocr/jobs/j1/changes": () => json(200, []),
      "GET /api/v1/files/f1/pages/1/preview": () => new Response(new Blob(["x"])),
    });
    renderAt("/documents/j1");
    const page = await screen.findByTestId("page-document");
    expect(await within(page).findByText(en("review.pending2"))).toBeInTheDocument();
    expect(within(page).getByText(/R1/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Excel/ })).not.toBeInTheDocument();
  });
});


describe("detail fixes (minor-fixes-ui)", () => {
  it("unfinished job detail redirects", async () => {
    signedIn({
      "GET /api/v1/ocr/jobs/jX": () => json(200, job("X", "OCR_PROCESSING")),
      "GET /api/v1/files/pending": () => json(200, []),
      "GET /api/v1/ocr/jobs": () => json(200, { items: [], total: 0, page: 1, page_size: 20 }),
    });
    renderAt("/documents/jX");
    expect(await screen.findByTestId("page-upload")).toBeInTheDocument();
  });
});
