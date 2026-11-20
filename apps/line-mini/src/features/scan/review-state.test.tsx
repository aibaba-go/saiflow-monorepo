import { screen, waitFor } from "@testing-library/react";
import userEventLib from "@testing-library/user-event";
import { Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { translate, type MessageKey } from "../../i18n";
import { LANGS, useLanguage } from "../../stores/language";
import { ORG, PERSONAL, signedIn, USER } from "../../test/fixtures";
import { json, mockApi } from "../../test/mockApi";
import { renderWithProviders } from "../../test/render";
import { NotificationsPage } from "../notifications/NotificationsPage";
import { renderNotification } from "../notifications/render";
import { useTenantChoice } from "../tenants/useCurrentTenant";
import { changeLabel } from "./changeLabel";
import { FinalResultPage } from "./FinalResultPage";
import { HistoryPage } from "./HistoryPage";
import { ResultPage } from "./ResultPage";

const userEvent = userEventLib.setup({ pointerEventsCheck: 0 });
const JOB = "/api/v1/ocr/jobs/j1";
const en = (k: MessageKey, v?: Record<string, string | number>) => translate("en", k, v);

const GROUPS = [
  {
    key: "document",
    name: "Document",
    names: { zh: "单据" },
    items: [{ kind: "field", key: "invoice_no", name: "Tax Invoice No.", type: "string", required: true }],
  },
  {
    key: "goods",
    name: "Goods",
    items: [
      {
        kind: "table",
        key: "line_items",
        name: "Line items",
        columns: [{ key: "quantity", name: "Quantity", type: "number" }],
      },
    ],
  },
];

const job = (stage: string, reviewLevel: number | null = null) => ({
  id: "j1",
  file_id: "f1",
  file_name: "invoice.png",
  page_count: 1,
  status: "SUCCEEDED",
  stage,
  error_code: null,
  engine: "textin",
  template_name: "Tax Invoice",
  created_at: "2026-11-06T00:00:00Z",
  confirmed_at: null,
  review_level: reviewLevel,
});

const review = (over: Record<string, unknown> = {}) => ({
  stage: "NONE",
  required_level: null,
  records: [],
  last_return: null,
  ...over,
});

const result = (over: Record<string, unknown> = {}) => ({
  version: 2,
  structured: { document: { invoice_no: "IV1" } },
  template: { template_version_id: 3, name: "Tax Invoice", groups: GROUPS },
  missing_required: [],
  mapping: null,
  confirmed: false,
  review: review(),
  ...over,
});

function Where() {
  const loc = useLocation();
  return <div data-testid="where">{loc.pathname}</div>;
}

function pages(route: string) {
  return renderWithProviders(
    <>
      <Routes>
        <Route path="/scan/jobs/:id/result" element={<ResultPage />} />
        <Route path="/scan/jobs/:id/final" element={<FinalResultPage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/reviews/:id" element={<div>review detail</div>} />
      </Routes>
      <Where />
    </>,
    { route },
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useLanguage.getState().setLang("en");
  useTenantChoice.getState().choose(null);
});

describe("change log (FR-SYS-122)", () => {
  it("label for header field and row", () => {
    expect(changeLabel("document.invoice_no", GROUPS as never, en)).toBe("Tax Invoice No.");
    expect(changeLabel("goods.line_items[1].quantity", GROUPS as never, en)).toBe("Line items · row 2 · Quantity");
    expect(changeLabel("other.thing", GROUPS as never, en)).toBe("other.thing");
    expect(changeLabel("document.invoice_no", null, en)).toBe("document.invoice_no");
  });

  it("lists entries and the template switch, or says there are none", async () => {
    const api = mockApi({
      [`GET ${JOB}`]: () => json(200, job("VERIFYING")),
      [`GET ${JOB}/result`]: () => json(200, result()),
      [`GET ${JOB}/changes`]: () =>
        json(200, [
          { kind: "FIELD", path: "document.invoice_no", before: "IV0", after: "IV1", from_template: null, to_template: null, user_name: "Somchai", created_at: "2026-11-06T01:00:00Z", version: 2 },
          { kind: "TEMPLATE", path: null, before: null, after: null, from_template: "Tax Invoice", to_template: null, user_name: "Somchai", created_at: "2026-11-06T02:00:00Z", version: 3 },
        ]),
    });
    signedIn(USER, [PERSONAL]);
    pages("/scan/jobs/j1/result");
    await userEvent.click(await screen.findByRole("button", { name: "Change log" }));
    const dialog = await screen.findByRole("dialog", { name: "Change log" });
    expect(dialog).toHaveTextContent("Tax Invoice No.");
    expect(dialog).toHaveTextContent("IV0 → IV1");
    expect(dialog).toHaveTextContent("Template changed: Tax Invoice → Generic result");
    api.set(`GET ${JOB}/changes`, () => json(200, []));
  });

  it("empty", async () => {
    mockApi({
      [`GET ${JOB}`]: () => json(200, job("VERIFYING")),
      [`GET ${JOB}/result`]: () => json(200, result()),
      [`GET ${JOB}/changes`]: () => json(200, []),
    });
    signedIn(USER, [PERSONAL]);
    pages("/scan/jobs/j1/result");
    await userEvent.click(await screen.findByRole("button", { name: "Change log" }));
    expect(await screen.findByText("No changes")).toBeInTheDocument();
  });
});

describe("review state on the result pages (FR-SYS-105-108)", () => {
  it("shows last return banner (105-04)", async () => {
    const back = { round_no: 1, level: 1, decision: "RETURN", comment: "税额不对", reviewer_name: "Ratana", created_at: "2026-11-06T03:00:00Z" };
    mockApi({
      [`GET ${JOB}`]: () => json(200, job("VERIFYING")),
      [`GET ${JOB}/result`]: () => json(200, result({ review: review({ records: [back], last_return: back }) })),
    });
    signedIn(USER, [PERSONAL]);
    pages("/scan/jobs/j1/result");
    const banner = await screen.findByRole("note");
    expect(banner).toHaveTextContent("Returned at Level-1 review by Ratana");
    expect(banner).toHaveTextContent("税额不对");
    expect(await screen.findByRole("textbox", { name: "Tax Invoice No." })).toBeEnabled();
  });

  it("submitted for review toast (106-03)", async () => {
    let stored = result();
    mockApi({
      [`GET ${JOB}`]: () => json(200, job(stored.confirmed ? "PENDING_REVIEW" : "VERIFYING", stored.confirmed ? 1 : null)),
      [`GET ${JOB}/result`]: () => json(200, stored),
      [`PATCH ${JOB}/result`]: () => {
        stored = result({ confirmed: true, review: review({ stage: "PENDING_L1", required_level: 1 }) });
        return json(200, stored);
      },
    });
    signedIn(USER, [PERSONAL]);
    pages("/scan/jobs/j1/result");
    await userEvent.click(await screen.findByRole("button", { name: "Continue" }));
    // the toast (role=status); the final page hero may show the same words as its title
    await waitFor(() =>
      expect(screen.getAllByText("Submitted for review").some((el) => el.getAttribute("role") === "status")).toBe(true),
    );
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/scan/jobs/j1/final"));
    expect(await screen.findAllByText("Waiting for level-1 review")).not.toHaveLength(0);
  });

  it("pending hides export and shows records (107-03)", async () => {
    const ok = { round_no: 1, level: 1, decision: "APPROVE", comment: "OK", reviewer_name: "R1", created_at: "2026-11-06T03:00:00Z" };
    mockApi({
      [`GET ${JOB}`]: () => json(200, job("PENDING_REVIEW", 2)),
      [`GET ${JOB}/result`]: () =>
        json(200, result({ confirmed: true, review: review({ stage: "PENDING_L2", required_level: 2, records: [ok] }) })),
    });
    signedIn(USER, [PERSONAL]);
    pages("/scan/jobs/j1/final");
    expect(await screen.findAllByText("Waiting for level-2 review")).not.toHaveLength(0);
    expect(screen.getByLabelText("Review history")).toHaveTextContent("R1");
    expect(screen.getByLabelText("Review history")).toHaveTextContent("OK");
    expect(screen.queryByRole("button", { name: /Export Excel/ })).toBeNull();
  });

  it("confirmed shows export", async () => {
    mockApi({
      [`GET ${JOB}`]: () => json(200, job("CONFIRMED")),
      [`GET ${JOB}/result`]: () => json(200, result({ confirmed: true, review: review({ stage: "CONFIRMED" }) })),
    });
    signedIn(USER, [PERSONAL]);
    pages("/scan/jobs/j1/final");
    expect(await screen.findByRole("button", { name: /Export Excel/ })).toBeInTheDocument();
  });

  it("pending filter and opens final (108-03)", async () => {
    mockApi({
      "GET /api/v1/ocr/jobs": (r) => {
        const stage = new URL(r.url).searchParams.get("stage");
        const items = !stage || stage === "PENDING_REVIEW" ? [job("PENDING_REVIEW", 1)] : [];
        return json(200, { items, total: items.length, page: 1, page_size: 20 });
      },
      [`GET ${JOB}`]: () => json(200, job("PENDING_REVIEW", 1)),
      [`GET ${JOB}/result`]: () => json(200, result({ confirmed: true, review: review({ stage: "PENDING_L1", required_level: 1 }) })),
    });
    signedIn(USER, [PERSONAL]);
    pages("/history");
    await userEvent.click(await screen.findByRole("button", { name: "To review" }));
    // the row says which level it waits for (AC-FR-SYS-108-03; final review Important 1)
    expect(await screen.findByText("Waiting for level-1 review")).toBeInTheDocument();
    await userEvent.click(await screen.findByText("invoice.png"));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/scan/jobs/j1/final"));
  });
});

describe("review notifications (FR-SYS-054)", () => {
  const note = {
    id: 9,
    type: "review_pending",
    tenant_id: ORG.tenant_id,
    data: { stage: "l1", job_id: "j1", file_name: "inv.pdf", template_name: "Tax Invoice", level: 1, confirmer_name: "Somchai", round_no: 1 },
    created_at: "2026-11-06T03:00:00Z",
    read: false,
  };

  it("words the review notice in every language", () => {
    for (const lang of LANGS) {
      const t = (k: MessageKey, v?: Record<string, string | number>) => translate(lang, k, v);
      const { title, body } = renderNotification(note, t, "Siam Tools");
      expect(title).not.toMatch(/\{|undefined/);
      expect(body).toContain("inv.pdf");
      expect(body).toContain("Siam Tools");
    }
  });

  it("review notification renders and navigates (054-05)", async () => {
    const api = mockApi({
      "GET /api/v1/me/notifications": () => json(200, { unread_count: 1, items: [note], next_before: null }),
      "POST /api/v1/me/notifications/read": () => json(200, { updated: 1, unread_count: 0 }),
    });
    signedIn(USER, [PERSONAL, ORG]);
    useTenantChoice.getState().choose(PERSONAL.tenant_id);
    pages("/notifications");
    await userEvent.click(await screen.findByText("A document is waiting for your review"));
    await waitFor(() => expect(screen.getByTestId("where")).toHaveTextContent("/reviews/j1"));
    expect(useTenantChoice.getState().id).toBe(ORG.tenant_id);
    expect(api.count("POST /api/v1/me/notifications/read")).toBe(1);
  });
});
