import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useLanguage } from "../stores/language";
import { en, renderAt, signedIn, userEvent } from "../test/app";
import { ORG, PERSONAL } from "../test/fixtures";
import { json } from "../test/mockApi";
import { useTenantChoice } from "../tenants/useCurrentTenant";

const USAGE = {
  plan: null,
  active: false,
  month: { month: "2026-11-01", quota: 0, used: 0, remaining: 0 },
  free: { remaining: 100, expires_at: null, paused: false },
};

const job = (n: number, stage = "CONFIRMED") => ({
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
  confirmed_at: null,
  review_level: null,
  returned: false,
});

function jobsApi(all: ReturnType<typeof job>[]) {
  return (r: Request) => {
    const q = new URL(r.url).searchParams;
    const rows = all.filter((j) => !q.get("stage") || j.stage === q.get("stage"));
    const size = Number(q.get("page_size"));
    return json(200, { items: rows.slice(0, size), total: rows.length, page: 1, page_size: size });
  };
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useTenantChoice.getState().reset();
  useLanguage.getState().setLang("en");
});

describe("menu (FR-SYS-094)", () => {
  it("personal tenant menu (094-02)", async () => {
    signedIn({ "GET /api/v1/billing/usage": () => json(200, USAGE), "GET /api/v1/ocr/jobs": jobsApi([]) });
    renderAt("/");
    const menu = await screen.findByRole("menu");
    for (const k of ["nav.upload", "nav.verify", "nav.library"] as const) {
      await waitFor(() => expect(within(menu).getByText(en(k))).toBeInTheDocument());
    }
    expect(within(menu).queryByText(en("nav.roles"))).not.toBeInTheDocument();
    expect(within(menu).queryByText(en("nav.reviews"))).not.toBeInTheDocument();
    expect(within(menu).queryByText(en("nav.data"))).not.toBeInTheDocument();
  });

  it("data browse only member (094-05)", async () => {
    localStorage.setItem("saiflow.pc.tenant.7", "5");
    useTenantChoice.getState().reset();
    signedIn(
      { "GET /api/v1/billing/usage": () => json(200, USAGE), "GET /api/v1/ocr/jobs": jobsApi([]) },
      { tenants: [PERSONAL, { ...ORG, permissions: ["data_browse"] }] },
    );
    renderAt("/");
    const menu = await screen.findByRole("menu");
    await waitFor(() => expect(within(menu).getByText(en("nav.library"))).toBeInTheDocument());
    expect(within(menu).queryByText(en("nav.upload"))).not.toBeInTheDocument();
    expect(within(menu).queryByText(en("nav.verify"))).not.toBeInTheDocument();
  });
});

describe("home (FR-SYS-094)", () => {
  it("home shows to-verify and recent five (094-06)", async () => {
    const all = [job(1, "VERIFYING"), job(2, "VERIFYING"), job(3, "VERIFYING"), job(4), job(5), job(6), job(7), job(8)];
    signedIn({
      "GET /api/v1/billing/usage": () => json(200, USAGE),
      "GET /api/v1/ocr/jobs": jobsApi(all),
      "GET /api/v1/ocr/jobs/j1": () => json(200, job(1, "VERIFYING")),
    });
    renderAt("/");
    const card = await screen.findByTestId("to-verify");
    await waitFor(() => expect(card).toHaveTextContent("3"));
    const recent = await screen.findByTestId("recent-tasks");
    await waitFor(() => expect(within(recent).getAllByRole("row").filter((r) => r.closest("tbody"))).toHaveLength(5));
    await userEvent.click(within(card).getByRole("link"));
    expect(await screen.findByTestId("page-verify")).toBeInTheDocument();
  });

  it("home empty state", async () => {
    signedIn({ "GET /api/v1/billing/usage": () => json(200, USAGE), "GET /api/v1/ocr/jobs": jobsApi([]) });
    renderAt("/");
    expect(await screen.findByText(en("home.noTasks"))).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: en("nav.upload") }));
    expect(await screen.findByTestId("page-upload")).toBeInTheDocument();
  });
});


describe("home to-verify (minor-fixes-ui)", () => {
  it("to-verify hidden without permission", async () => {
    localStorage.setItem("saiflow.pc.tenant.7", "5");
    useTenantChoice.getState().reset();
    signedIn(
      { "GET /api/v1/billing/usage": () => json(200, USAGE), "GET /api/v1/ocr/jobs": jobsApi([job(1, "VERIFYING")]) },
      { tenants: [PERSONAL, { ...ORG, permissions: ["data_browse"] }] },
    );
    renderAt("/");
    await screen.findByTestId("recent-tasks");
    expect(screen.queryByTestId("to-verify")).not.toBeInTheDocument();
  });

  it("to-verify counts own editable", async () => {
    localStorage.setItem("saiflow.pc.tenant.7", "5");
    useTenantChoice.getState().reset();
    const mine = { ...job(1, "VERIFYING"), created_by_user_id: 7 };
    const theirs = { ...job(2, "VERIFYING"), created_by_user_id: 8 };
    signedIn(
      { "GET /api/v1/billing/usage": () => json(200, USAGE), "GET /api/v1/ocr/jobs": jobsApi([mine, theirs]) },
      { tenants: [PERSONAL, { ...ORG, permissions: ["verify_own", "data_browse"] }] },
    );
    renderAt("/");
    const card = await screen.findByTestId("to-verify");
    await waitFor(() => expect(card).toHaveTextContent("1"));
    expect(card).not.toHaveTextContent("2");
  });
});
