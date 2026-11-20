import { act, screen, waitFor } from "@testing-library/react";
import userEventLib from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { useLanguage } from "../../stores/language";
import { ORG, signedIn, USER } from "../../test/fixtures";
import { json, mockApi } from "../../test/mockApi";
import { renderWithProviders } from "../../test/render";
import { OrgPage } from "../orgs/OrgPage";
import { useTenantChoice } from "../tenants/useCurrentTenant";
import { ReviewDetailPage } from "./ReviewDetailPage";
import { ReviewEntry } from "./ReviewEntry";
import { ReviewQueuePage } from "./ReviewQueuePage";
import { ReviewSettingsPage } from "./ReviewSettingsPage";

const userEvent = userEventLib.setup({ pointerEventsCheck: 0 });

const REVIEWER = { ...ORG, permissions: ["review_l1"] };
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
  review_level: 1,
};

const item = (id: string, block: string | null = null) => ({
  job_id: id,
  file_id: "f1",
  file_name: `${id}.png`,
  page_count: 1,
  template_name: "Tax Invoice",
  confirmed_by_name: "Somchai",
  confirmed_at: "2026-11-06T01:00:00Z",
  level: 1,
  required_level: 1,
  level_entered_at: "2026-11-06T01:00:00Z",
  block_reason: block,
});

const result = {
  version: 2,
  structured: { document: { invoice_no: "IV1" } },
  template: { template_version_id: 3, name: "Tax Invoice", groups: [] },
  missing_required: [],
  mapping: null,
  confirmed: true,
  review: { stage: "PENDING_L1", required_level: 1, records: [], last_return: null },
};

const detail = (block: string | null = null) => ({
  job,
  level: 1,
  required_level: 1,
  confirmed_by_name: "Somchai",
  confirmed_at: "2026-11-06T01:00:00Z",
  block_reason: block,
});

function pages(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<ReviewEntry />} />
      <Route path="/reviews" element={<ReviewQueuePage />} />
      <Route path="/reviews/:id" element={<ReviewDetailPage />} />
      <Route path="/org" element={<OrgPage />} />
      <Route path="/org/review-settings" element={<ReviewSettingsPage />} />
    </Routes>,
    { route },
  );
}

function detailApi(block: string | null = null) {
  return mockApi({
    "GET /api/v1/reviews/j1": () => json(200, detail(block)),
    "GET /api/v1/ocr/jobs/j1/result": () => json(200, result),
    "GET /api/v1/ocr/jobs/j1/changes": () => json(200, []),
    "GET /api/v1/reviews": () => json(200, { items: [], total: 0, page: 1, page_size: 20 }),
    "POST /api/v1/reviews/j1/decision": () => json(200, { ...detail(), level: null }),
  });
}

beforeEach(() => {
  localStorage.clear();
  useLanguage.getState().setLang("en");
  useTenantChoice.getState().choose(null);
});

describe("review entry (FR-SYS-119)", () => {
  it("entry shows actionable count (119-01)", async () => {
    mockApi({ "GET /api/v1/reviews/summary": () => json(200, { l1: 2, l2: null }) });
    signedIn(USER, [REVIEWER]);
    useTenantChoice.getState().choose(REVIEWER.tenant_id);
    pages("/");
    expect(await screen.findByText(/waiting for your review/)).toBeInTheDocument();
    expect(await screen.findByLabelText("2 to review")).toHaveTextContent("2");
  });

  it("prompt only while there is something to review, in each language", async () => {
    const api = mockApi({ "GET /api/v1/reviews/summary": () => json(200, { l1: 0, l2: null }) });
    signedIn(USER, [REVIEWER]);
    useTenantChoice.getState().choose(REVIEWER.tenant_id);
    pages("/");
    await waitFor(() => expect(api.count("GET /api/v1/reviews/summary")).toBe(1));
    await waitFor(() => expect(screen.queryByText(/waiting for your review/)).toBeNull());
    expect(screen.queryByLabelText("0 to review")).toBeNull();
  });

  it("prompt reads naturally in Thai and Chinese", async () => {
    mockApi({ "GET /api/v1/reviews/summary": () => json(200, { l1: 1, l2: 2 }) });
    signedIn(USER, [REVIEWER]);
    useTenantChoice.getState().choose(REVIEWER.tenant_id);
    useLanguage.getState().setLang("zh");
    pages("/");
    const zhBtn = await screen.findByRole("button", { name: /份单据待你复核/ });
    expect(zhBtn).toHaveTextContent("有 3 份单据待你复核");
    act(() => useLanguage.getState().setLang("th"));
    expect(await screen.findByRole("button", { name: /เอกสารรอให้คุณตรวจสอบ/ })).toHaveTextContent("3");
  });

  it("entry hidden without permission (119-02)", async () => {
    const api = mockApi({ "GET /api/v1/reviews/summary": () => json(200, { l1: null, l2: null }) });
    signedIn(USER, [ORG]);
    useTenantChoice.getState().choose(ORG.tenant_id);
    pages("/");
    await waitFor(() => expect(screen.queryByText("To review")).toBeNull());
    expect(screen.queryByText(/waiting for your review/)).toBeNull();
    expect(api.count("GET /api/v1/reviews/summary")).toBe(0);
  });
});

describe("queue and detail (FR-SYS-120)", () => {
  it("approve returns to queue (120-01)", async () => {
    const api = detailApi();
    signedIn(USER, [REVIEWER]);
    useTenantChoice.getState().choose(REVIEWER.tenant_id);
    pages("/reviews/j1");
    await userEvent.click(await screen.findByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("dialog", { name: "Approve this document?" });
    await userEvent.click(dialog.querySelector("button:last-of-type") as HTMLButtonElement);
    expect(await screen.findByText("Approved")).toBeInTheDocument(); // toast on the queue
    expect(await api.bodies("POST /api/v1/reviews/j1/decision")).toEqual([
      { level: 1, decision: "approve", comment: null },
    ]);
  });

  it("return requires comment (120-02)", async () => {
    const api = detailApi();
    signedIn(USER, [REVIEWER]);
    useTenantChoice.getState().choose(REVIEWER.tenant_id);
    pages("/reviews/j1");
    await userEvent.click(await screen.findByRole("button", { name: "Return" }));
    const dialog = await screen.findByRole("dialog", { name: "Return this document?" });
    const submit = dialog.querySelector("button:last-of-type") as HTMLButtonElement;
    expect(submit).toBeDisabled();
    await userEvent.type(screen.getByLabelText("Reason for return"), "日期看不清");
    expect(submit).toBeEnabled();
    await userEvent.click(submit);
    expect(await screen.findByText("Returned")).toBeInTheDocument();
    expect(await api.bodies("POST /api/v1/reviews/j1/decision")).toEqual([
      { level: 1, decision: "return", comment: "日期看不清" },
    ]);
  });

  it("own confirmation is read-only (120-03)", async () => {
    mockApi({
      "GET /api/v1/reviews": () => json(200, { items: [item("j1", "own_confirmation")], total: 1, page: 1, page_size: 20 }),
      "GET /api/v1/reviews/j1": () => json(200, detail("own_confirmation")),
      "GET /api/v1/ocr/jobs/j1/result": () => json(200, result),
    });
    signedIn(USER, [OWNER]);
    useTenantChoice.getState().choose(OWNER.tenant_id);
    pages("/reviews");
    expect(await screen.findByText("You confirmed this")).toBeInTheDocument();
    await userEvent.click(screen.getByText("j1.png"));
    expect(await screen.findByText("You confirmed this")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Return" })).toBeNull();
  });

  it("409 shows handled by others", async () => {
    const api = detailApi();
    api.set("POST /api/v1/reviews/j1/decision", () => json(409, { code: "review_state_changed" }));
    signedIn(USER, [REVIEWER]);
    useTenantChoice.getState().choose(REVIEWER.tenant_id);
    pages("/reviews/j1");
    await userEvent.click(await screen.findByRole("button", { name: "Approve" }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(dialog.querySelector("button:last-of-type") as HTMLButtonElement);
    expect(await screen.findByText("This document has already been handled by someone else.")).toBeInTheDocument();
  });

  it("queue has one tab per held level", async () => {
    mockApi({
      "GET /api/v1/reviews": () => json(200, { items: [item("a"), item("b")], total: 2, page: 1, page_size: 20 }),
    });
    signedIn(USER, [{ ...ORG, permissions: ["review_l1", "review_l2"] }]);
    useTenantChoice.getState().choose(ORG.tenant_id);
    pages("/reviews");
    expect(await screen.findByRole("tab", { name: "Level-1 review" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Level-2 review" })).toBeInTheDocument();
    expect(await screen.findByText("a.png")).toBeInTheDocument();
  });

  const EXTRA_GROUPS = [
    {
      key: "document",
      name: "Document",
      items: [
        { kind: "field", key: "invoice_no", name: "Tax Invoice No.", type: "string", required: true },
        { kind: "field", key: "date", name: "Date", type: "date" },
      ],
    },
  ];
  const withExtra = {
    ...result,
    structured: { document: { invoice_no: "IV1", date: "2026-11-01", Remark: "Call supplier" } },
    template: { ...result.template, groups: EXTRA_GROUPS },
  };

  it.each([
    [1, ["review_l1"]],
    [2, ["review_l2"]],
  ])("level-%s detail shows extra fields read-only, decisions unchanged (120-04)", async (level, permissions) => {
    const api = detailApi();
    api.set("GET /api/v1/reviews/j1", () => json(200, { ...detail(), level, required_level: 2, job: { ...job, review_level: level } }));
    api.set("GET /api/v1/ocr/jobs/j1/result", () => json(200, withExtra));
    signedIn(USER, [{ ...ORG, permissions }]);
    useTenantChoice.getState().choose(ORG.tenant_id);
    pages("/reviews/j1");
    expect(await screen.findByLabelText("Remark")).toHaveTextContent("Call supplier");
    const paths = [...document.querySelectorAll("dl [data-path]")].map((el) => el.getAttribute("data-path"));
    expect(paths).toEqual(["document.invoice_no", "document.date", "document.Remark"]);
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: /Add field|Delete field/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Approve" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Return" })).toBeInTheDocument();
  });

  it.each(["own_confirmation", "did_level1"])("blocked (%s): extra fields shown, still no decision (120-05)", async (block) => {
    const api = detailApi(block);
    api.set("GET /api/v1/ocr/jobs/j1/result", () => json(200, withExtra));
    signedIn(USER, [OWNER]);
    useTenantChoice.getState().choose(OWNER.tenant_id);
    pages("/reviews/j1");
    expect(await screen.findByLabelText("Remark")).toHaveTextContent("Call supplier");
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByRole("button", { name: "Approve" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Return" })).toBeNull();
  });
});

describe("review settings (FR-SYS-121)", () => {
  const settings = {
    email_enabled: false,
    items: [
      { template_id: 7, name: "Tax Invoice", level: 0 },
      { template_id: null, name: null, level: 0 },
    ],
  };

  it("owner sets level (121-01)", async () => {
    const api = mockApi({
      "GET /api/v1/review-settings": () => json(200, settings),
      "PUT /api/v1/review-settings/levels": () => json(200, { template_id: 7, name: "Tax Invoice", level: 2 }),
    });
    signedIn(USER, [OWNER]);
    useTenantChoice.getState().choose(OWNER.tenant_id);
    pages("/org/review-settings");
    await userEvent.selectOptions(await screen.findByLabelText("Tax Invoice"), "2");
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(await api.bodies("PUT /api/v1/review-settings/levels")).toEqual([{ template_id: 7, level: 2 }]);
    expect(screen.getByLabelText("In-app notification (always on)")).toBeDisabled();
  });

  it("failed save restores the old value", async () => {
    mockApi({
      "GET /api/v1/review-settings": () => json(200, settings),
      "PUT /api/v1/review-settings/levels": () => json(403, { code: "permission_denied" }),
    });
    signedIn(USER, [OWNER]);
    useTenantChoice.getState().choose(OWNER.tenant_id);
    pages("/org/review-settings");
    const select = (await screen.findByLabelText("Tax Invoice")) as HTMLSelectElement;
    await userEvent.selectOptions(select, "1");
    await waitFor(() => expect(select.value).toBe("0"));
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});


describe("review page fixes (minor-fixes-ui)", () => {
  it("result error does not spin", async () => {
    mockApi({
      "GET /api/v1/reviews/j1": () => json(200, detail()),
      "GET /api/v1/ocr/jobs/j1/result": () => json(500, { code: "internal" }),
    });
    signedIn(USER, [REVIEWER]);
    useTenantChoice.getState().choose(REVIEWER.tenant_id);
    pages("/reviews/j1");
    expect(await screen.findByText("Something went wrong. Please try again later.")).toBeInTheDocument();
  });

  it("no duplicate rows across pages", async () => {
    mockApi({
      "GET /api/v1/reviews": (r) => {
        const page = Number(new URL(r.url).searchParams.get("page"));
        const items = page === 1 ? Array.from({ length: 20 }, (_, i) => item(`a${i}`)) : [item("a19"), item("b1")];
        return json(200, { items, total: 22, page, page_size: 20 });
      },
    });
    signedIn(USER, [REVIEWER]);
    useTenantChoice.getState().choose(REVIEWER.tenant_id);
    pages("/reviews");
    await screen.findByText("a0.png");
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByText("b1.png");
    expect(screen.getAllByText("a19.png")).toHaveLength(1);
  });

  it("failed save keeps the other change", async () => {
    let first = true;
    const settings = {
      email_enabled: false,
      items: [
        { template_id: 7, name: "Tax Invoice", level: 0 },
        { template_id: 8, name: "Billing Note", level: 0 },
      ],
    };
    mockApi({
      "GET /api/v1/review-settings": () => json(200, settings),
      "PUT /api/v1/review-settings/levels": async () => {
        if (first) {
          first = false;
          await new Promise((r) => setTimeout(r, 600));
          return json(500, { code: "internal" });
        }
        return json(200, { template_id: 8, name: "Billing Note", level: 2 });
      },
    });
    signedIn(USER, [OWNER]);
    useTenantChoice.getState().choose(OWNER.tenant_id);
    pages("/org/review-settings");
    const tax = (await screen.findByLabelText("Tax Invoice")) as HTMLSelectElement;
    const bill = screen.getByLabelText("Billing Note") as HTMLSelectElement;
    await userEvent.selectOptions(tax, "1");
    await userEvent.selectOptions(bill, "2");
    await waitFor(() => expect(tax.value).toBe("0"));
    expect(bill.value).toBe("2");
  });
});
