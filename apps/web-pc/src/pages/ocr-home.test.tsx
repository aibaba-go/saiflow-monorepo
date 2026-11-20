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

describe("home metric strip (enterprise-ui-redesign)", () => {
  it("shows the real per-stage totals and opens the library on that stage", async () => {
    const all = [job(1, "VERIFYING"), job(2, "VERIFYING"), job(3, "PENDING_REVIEW"), job(4), job(5), job(6, "OCR_PROCESSING")];
    const seen: Record<string, string>[] = [];
    const api = jobsApi(all);
    signedIn({
      "GET /api/v1/billing/usage": () => json(200, USAGE),
      "GET /api/v1/ocr/jobs": (r) => {
        seen.push(Object.fromEntries(new URL(r.url).searchParams));
        return api(r);
      },
    });
    renderAt("/");
    const strip = await screen.findByTestId("metric-strip");
    const links = within(strip).getAllByRole("link");
    expect(links.map((l) => l.getAttribute("href"))).toEqual([
      "/library?stage=VERIFYING",
      "/library?stage=OCR_PROCESSING",
      "/library?stage=PENDING_REVIEW",
      "/library?stage=CONFIRMED",
    ]);
    expect(links.map((l) => l.textContent)).toEqual([
      `2${en("home.metric.VERIFYING")}`,
      `1${en("home.metric.OCR_PROCESSING")}`,
      `1${en("home.metric.PENDING_REVIEW")}`,
      `2${en("home.metric.CONFIRMED")}`,
    ]);
    // the counts are the totals of the existing list endpoint, read one row per stage
    for (const stage of ["VERIFYING", "OCR_PROCESSING", "PENDING_REVIEW", "CONFIRMED"]) {
      expect(seen).toContainEqual(expect.objectContaining({ stage, page_size: "1" }));
    }
    seen.length = 0;
    await userEvent.click(links[2]!);
    expect(await screen.findByTestId("page-library")).toBeInTheDocument();
    await waitFor(() =>
      expect(seen.filter((q) => q.page_size === "20").at(-1)).toMatchObject({ stage: "PENDING_REVIEW", page: "1" }),
    );
    const tab = within(screen.getByRole("tablist")).getByRole("tab", { name: new RegExp(`^${en("stage.PENDING_REVIEW")}`) });
    expect(tab).toHaveAttribute("aria-selected", "true");
  });

  it("is left out when the counts cannot be read", async () => {
    const api = jobsApi([job(1), job(2)]);
    let failed = 0;
    signedIn({
      "GET /api/v1/billing/usage": () => json(200, USAGE),
      "GET /api/v1/ocr/jobs": (r) => {
        if (new URL(r.url).searchParams.get("page_size") !== "1") return api(r);
        failed += 1;
        return json(500, { code: "internal" });
      },
    });
    renderAt("/");
    const recent = await screen.findByTestId("recent-tasks");
    await waitFor(() => expect(within(recent).getAllByRole("row").filter((r) => r.closest("tbody"))).toHaveLength(2));
    await waitFor(() => expect(failed).toBe(4));
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByTestId("metric-strip")).not.toBeInTheDocument();
    // no metric links (the recent table may show the same words as status chips)
    expect(document.querySelector('a[href^="/library?stage="]')).toBeNull();
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
