import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useLanguage } from "../stores/language";
import { en, renderAt, signedIn, userEvent } from "../test/app";
import { ORG, PERSONAL } from "../test/fixtures";
import { json } from "../test/mockApi";
import { useTenantChoice } from "../tenants/useCurrentTenant";

const REVIEWER = { ...ORG, permissions: ["review_l1"] };
const BOTH = { ...ORG, permissions: ["review_l1", "review_l2"] };
const OWNER = { ...ORG, is_owner: true, permissions: [] };

const job = {
  id: "j1",
  file_id: "f1",
  file_name: "invoice.png",
  page_count: 1,
  status: "SUCCEEDED",
  stage: "PENDING_REVIEW",
  error_code: null,
  engine: "textin",
  template_name: "Tax Invoice",
  created_at: "2026-11-06T00:00:00Z",
  confirmed_at: "2026-11-06T01:00:00Z",
  review_level: 2,
};

const item = (n: number) => ({
  job_id: `j${n}`,
  file_id: "f1",
  file_name: `doc-${n}.png`,
  page_count: 1,
  template_name: "Tax Invoice",
  confirmed_by_name: "Somchai",
  confirmed_at: "2026-11-06T01:00:00Z",
  level: 1,
  required_level: 1,
  level_entered_at: "2026-11-06T01:00:00Z",
  block_reason: null,
});

const detail = { job, level: 2, required_level: 2, confirmed_by_name: "Somchai", confirmed_at: "2026-11-06T01:00:00Z", block_reason: null };
const result = {
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
  review: { stage: "PENDING_L2", required_level: 2, records: [], last_return: null },
};

function inOrg(tenant: typeof ORG) {
  localStorage.setItem("saiflow.pc.tenant.7", String(tenant.tenant_id));
  useTenantChoice.getState().reset();
  return { tenants: [PERSONAL, tenant] };
}

const detailRoutes = {
  "GET /api/v1/reviews/j1": () => json(200, detail),
  "GET /api/v1/ocr/jobs/j1/result": () => json(200, result),
  "GET /api/v1/ocr/jobs/j1/changes": () => json(200, []),
  "GET /api/v1/files/f1/pages/1/preview": () => new Response(new Blob(["x"], { type: "image/png" })),
  "GET /api/v1/reviews": () => json(200, { items: [], total: 0, page: 1, page_size: 20 }),
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useTenantChoice.getState().reset();
  useLanguage.getState().setLang("en");
});

describe("menu (FR-SYS-094)", () => {
  it("menu shows reviews not settings for reviewer (094-04)", async () => {
    signedIn({ "GET /api/v1/reviews": () => json(200, { items: [], total: 0, page: 1, page_size: 20 }) }, inOrg(REVIEWER));
    renderAt("/reviews");
    const menu = await screen.findByRole("menu");
    await waitFor(() => expect(within(menu).getByText(en("nav.reviews"))).toBeInTheDocument());
    expect(within(menu).queryByText(en("nav.reviewSettings"))).not.toBeInTheDocument();
  });

  it("personal tenant hides review menus (094-02)", async () => {
    signedIn({});
    renderAt("/notifications");
    const menu = await screen.findByRole("menu");
    await waitFor(() => expect(within(menu).getByText(en("nav.org"))).toBeInTheDocument());
    expect(within(menu).queryByText(en("nav.reviews"))).not.toBeInTheDocument();
    expect(within(menu).queryByText(en("nav.reviewSettings"))).not.toBeInTheDocument();
  });
});

describe("queue (FR-SYS-123)", () => {
  it("queue paginates 20 (123-01)", async () => {
    const all = Array.from({ length: 25 }, (_, i) => item(i + 1));
    signedIn(
      {
        "GET /api/v1/reviews": (r) => {
          const url = new URL(r.url);
          const page = Number(url.searchParams.get("page"));
          const size = Number(url.searchParams.get("page_size"));
          return json(200, { items: all.slice((page - 1) * size, page * size), total: 25, page, page_size: size });
        },
      },
      inOrg(BOTH),
    );
    renderAt("/reviews");
    expect(await screen.findByRole("tab", { name: en("review.level1") })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: en("review.level2") })).toBeInTheDocument();
    expect(await screen.findByText("doc-20.png")).toBeInTheDocument();
    expect(screen.queryByText("doc-21.png")).not.toBeInTheDocument();
    await userEvent.click(screen.getByTitle("2"));
    expect(await screen.findByText("doc-25.png")).toBeInTheDocument();
    expect(screen.queryByText("doc-1.png")).not.toBeInTheDocument();
  });
});

describe("detail (FR-SYS-124)", () => {
  it("return from detail (124-01)", async () => {
    const api = signedIn(
      { ...detailRoutes, "POST /api/v1/reviews/j1/decision": () => json(200, { ...detail, level: null, job: { ...job, stage: "VERIFYING" } }) },
      inOrg({ ...ORG, permissions: ["review_l2"] }),
    );
    renderAt("/reviews/j1");
    expect(await screen.findByText("IV1")).toBeInTheDocument();
    await userEvent.click(await screen.findByRole("button", { name: en("review.return") }));
    const dialog = await screen.findByRole("dialog");
    const ok = within(dialog).getByRole("button", { name: en("review.return") });
    expect(ok).toBeDisabled();
    await userEvent.type(within(dialog).getByRole("textbox"), "税额不对");
    await userEvent.click(ok);
    expect(await screen.findByTestId("page-reviews")).toBeInTheDocument();
    expect(await api.bodies("POST /api/v1/reviews/j1/decision")).toEqual([{ level: 2, decision: "return", comment: "税额不对" }]);
  });

  it("already handled (124-02)", async () => {
    signedIn(
      { ...detailRoutes, "POST /api/v1/reviews/j1/decision": () => json(409, { code: "review_state_changed" }) },
      inOrg({ ...ORG, permissions: ["review_l2"] }),
    );
    renderAt("/reviews/j1");
    await userEvent.click(await screen.findByRole("button", { name: en("review.approve") }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: en("review.approve") }));
    expect(await screen.findByText(en("review.handled"))).toBeInTheDocument();
    expect(await screen.findByTestId("page-reviews")).toBeInTheDocument();
  });
});

describe("settings (FR-SYS-125)", () => {
  it("owner sets generic level (125-01)", async () => {
    const api = signedIn(
      {
        "GET /api/v1/review-settings": () =>
          json(200, { email_enabled: false, items: [{ template_id: 7, name: "Tax Invoice", level: 0 }, { template_id: null, name: null, level: 0 }] }),
        "PUT /api/v1/review-settings/levels": () => json(200, { template_id: null, name: null, level: 1 }),
      },
      inOrg(OWNER),
    );
    renderAt("/review-settings");
    const row = (await screen.findByText(en("review.generic"))).closest("tr") as HTMLElement;
    await userEvent.click(within(row).getByText(en("review.settings.l1")));
    expect(await screen.findByText(en("review.saved"))).toBeInTheDocument();
    expect(await api.bodies("PUT /api/v1/review-settings/levels")).toEqual([{ template_id: null, level: 1 }]);
  });
});

describe("notifications (FR-SYS-103)", () => {
  it("review notification opens detail or warns (103-03)", async () => {
    const note = {
      id: 9,
      type: "review_pending",
      tenant_id: ORG.tenant_id,
      data: { stage: "l2", job_id: "j1", file_name: "inv.pdf", template_name: "Tax Invoice", level: 2, confirmer_name: "Somchai", round_no: 1 },
      created_at: "2026-11-06T03:00:00Z",
      read: false,
    };
    signedIn(
      {
        "GET /api/v1/me/notifications": () => json(200, { unread_count: 1, items: [note], next_before: null }),
        "POST /api/v1/me/notifications/read": () => json(200, { updated: 1, unread_count: 0 }),
        "GET /api/v1/reviews/j1": () => json(404, { code: "not_found" }),
        "GET /api/v1/reviews": () => json(200, { items: [], total: 0, page: 1, page_size: 20 }),
      },
      { tenants: [PERSONAL, { ...ORG, permissions: ["review_l2"] }] },
    );
    renderAt("/notifications");
    await userEvent.click(await screen.findByText(en("notif.review_pending.title")));
    expect(await screen.findByText(en("review.handled"))).toBeInTheDocument();
    await waitFor(() => expect(useTenantChoice.getState().id).toBe(ORG.tenant_id));
  });
});


describe("review page fixes (minor-fixes-ui)", () => {
  it("left org notice label and no tenant switch", async () => {
    const note = {
      id: 9,
      type: "review_pending",
      tenant_id: 99,
      data: { stage: "l1", job_id: "j1", file_name: "inv.pdf", template_name: "Tax Invoice", level: 1, confirmer_name: "S", round_no: 1 },
      created_at: "2026-11-06T03:00:00Z",
      read: false,
    };
    signedIn({
      "GET /api/v1/me/notifications": () => json(200, { unread_count: 1, items: [note], next_before: null }),
      "POST /api/v1/me/notifications/read": () => json(200, { updated: 1, unread_count: 0 }),
    });
    renderAt("/notifications");
    expect(await screen.findByText(new RegExp(en("tenant.left")))).toBeInTheDocument();
    await userEvent.click(screen.getByText(en("notif.review_pending.title")));
    expect(await screen.findByText(en("review.handled"))).toBeInTheDocument();
    expect(useTenantChoice.getState().id).toBeNull();
  });

  it("result error does not spin", async () => {
    signedIn(
      {
        ...detailRoutes,
        "GET /api/v1/ocr/jobs/j1/result": () => json(500, { code: "internal" }),
      },
      inOrg({ ...ORG, permissions: ["review_l2"] }),
    );
    renderAt("/reviews/j1");
    expect(await screen.findByText(en("err.unknown"))).toBeInTheDocument();
  });

  it("failed save keeps the other change", async () => {
    let first = true;
    signedIn(
      {
        "GET /api/v1/review-settings": () =>
          json(200, {
            email_enabled: false,
            items: [
              { template_id: 7, name: "Tax Invoice", level: 0 },
              { template_id: 8, name: "Billing Note", level: 0 },
            ],
          }),
        "PUT /api/v1/review-settings/levels": async () => {
          if (first) {
            first = false;
            await new Promise((r) => setTimeout(r, 600));
            return json(500, { code: "internal" });
          }
          return json(200, { template_id: 8, name: "Billing Note", level: 2 });
        },
      },
      inOrg(OWNER),
    );
    renderAt("/review-settings");
    const tax = (await screen.findByText("Tax Invoice")).closest("tr") as HTMLElement;
    const bill = screen.getByText("Billing Note").closest("tr") as HTMLElement;
    await userEvent.click(within(tax).getByText(en("review.settings.l1")));
    await userEvent.click(within(bill).getByText(en("review.settings.l2")));
    // the failed save puts back only its own row; the other change stays
    const picked = (row: HTMLElement, key: Parameters<typeof en>[0]) =>
      within(row).getByText(en(key)).closest("label")!.classList.contains("ant-radio-button-wrapper-checked");
    await waitFor(() => expect(picked(tax, "review.settings.none")).toBe(true), { timeout: 3000 });
    expect(picked(bill, "review.settings.l2")).toBe(true);
  });
});
