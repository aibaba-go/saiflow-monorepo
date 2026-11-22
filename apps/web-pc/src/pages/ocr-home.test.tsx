import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useLanguage } from "../stores/language";
import { dashboard, en, renderAt, signedIn, userEvent } from "../test/app";
import { ORG, PERSONAL } from "../test/fixtures";
import { json } from "../test/mockApi";
import { useTenantChoice } from "../tenants/useCurrentTenant";

const USAGE = {
  plan: null, active: false,
  month: { month: "2026-11-01", quota: 0, used: 0, remaining: 0 },
  free: { remaining: 100, expires_at: null, paused: false },
};

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useTenantChoice.getState().reset();
  useLanguage.getState().setLang("en");
});

describe("menu (FR-SYS-094)", () => {
  it("personal tenant menu (094-02)", async () => {
    signedIn();
    renderAt("/");
    const menu = await screen.findByRole("menu");
    for (const k of ["nav.upload", "nav.verify", "nav.library"] as const) {
      await waitFor(() => expect(within(menu).getByText(en(k))).toBeInTheDocument());
    }
    for (const k of ["nav.roles", "nav.reviews", "nav.data"] as const) {
      expect(within(menu).queryByText(en(k))).not.toBeInTheDocument();
    }
  });

  it("data browse only member (094-05)", async () => {
    localStorage.setItem("saiflow.pc.tenant.7", "5");
    useTenantChoice.getState().reset();
    signedIn({}, { tenants: [PERSONAL, { ...ORG, permissions: ["data_browse"] }] });
    renderAt("/");
    const menu = await screen.findByRole("menu");
    await waitFor(() => expect(within(menu).getByText(en("nav.library"))).toBeInTheDocument());
    expect(within(menu).queryByText(en("nav.upload"))).not.toBeInTheDocument();
    expect(within(menu).queryByText(en("nav.verify"))).not.toBeInTheDocument();
  });
});

describe("PG dashboard (FR-SYS-094/172)", () => {
  it("shows the server's recent five without the removed to-verify panel", async () => {
    signedIn({
      "GET /api/v1/me/dashboard": () => json(200, {
        ...dashboard("personal"), counts: { VERIFYING: 3, OCR_PROCESSING: 0, PENDING_REVIEW: 0, CONFIRMED: 5 },
        recent: Array.from({ length: 5 }, (_, i) => ({ id: `j${i}`, original_name: `doc-${i}.png`, stage: "CONFIRMED", created_at: "2026-11-07T01:00:00Z" })),
      }),
    });
    renderAt("/");
    const recent = await screen.findByTestId("recent-tasks");
    expect(within(recent).getAllByRole("row").filter((r) => r.closest("tbody"))).toHaveLength(5);
    expect(within(recent).getByRole("link", { name: "doc-0.png" })).toHaveAttribute("href", "/documents/j0");
    expect(screen.queryByTestId("to-verify")).not.toBeInTheDocument();
    const progress = screen.getByTestId("progress-card");
    expect(within(progress).getAllByRole("progressbar").map(p => p.getAttribute("aria-valuenow"))).toEqual(["3", "0", "0", "5"]);
    expect(recent.closest(".pc-system-dashboard__body")).toBeNull();
    expect(within(screen.getByTestId("metric-strip")).getAllByRole("link")[0]).toHaveTextContent("3");
  });

  it("offers upload in the permitted empty state", async () => {
    signedIn();
    renderAt("/");
    expect(await screen.findByText(en("home.noTasks"))).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: en("nav.upload") }));
    expect(await screen.findByTestId("page-upload")).toBeInTheDocument();
  });

  it("uses scoped PG counts and opens the library on that stage", async () => {
    const seen: Record<string, string>[] = [];
    signedIn({
      "GET /api/v1/me/dashboard": () => json(200, { ...dashboard("personal"), counts: { VERIFYING: 2, OCR_PROCESSING: 1, PENDING_REVIEW: 1, CONFIRMED: 2 } }),
      "GET /api/v1/billing/usage": () => json(200, USAGE),
      "GET /api/v1/ocr/jobs": (r) => {
        seen.push(Object.fromEntries(new URL(r.url).searchParams));
        return json(200, { items: [], total: 0, page: 1, page_size: 20 });
      },
    });
    renderAt("/");
    const strip = await screen.findByTestId("metric-strip");
    const links = within(strip).getAllByRole("link");
    const stages = ["VERIFYING", "OCR_PROCESSING", "PENDING_REVIEW", "CONFIRMED"] as const;
    expect(links.map((l) => l.getAttribute("href"))).toEqual(stages.map((s) => `/library?stage=${s}`));
    expect(links.map((l) => l.textContent)).toEqual(stages.map((s, i) => `${[2, 1, 1, 2][i]}${en(`home.metric.${s}`)}`));
    expect(seen).toHaveLength(0);
    await userEvent.click(links[2]!);
    expect(await screen.findByTestId("page-library")).toBeInTheDocument();
    await waitFor(() => expect(seen.filter((q) => q.page_size === "20").at(-1)).toMatchObject({ stage: "PENDING_REVIEW", page: "1" }));
    const tab = within(screen.getByRole("tablist")).getByRole("tab", { name: new RegExp(`^${en("stage.PENDING_REVIEW")}`) });
    expect(tab).toHaveAttribute("aria-selected", "true");
  });

  it("does not display fabricated metrics when PG is unavailable", async () => {
    signedIn({ "GET /api/v1/me/dashboard": () => json(503, { code: "data_source_unavailable" }) });
    renderAt("/");
    expect(await screen.findByRole("alert")).toBeInTheDocument();
    expect(screen.queryByTestId("metric-strip")).not.toBeInTheDocument();
    expect(screen.queryByTestId("usage-card")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: en("common.retry") })).toBeInTheDocument();
  });

  it("does not offer upload to a browse-only member", async () => {
    localStorage.setItem("saiflow.pc.tenant.7", "5");
    useTenantChoice.getState().reset();
    signedIn({}, { tenants: [PERSONAL, { ...ORG, permissions: ["data_browse"] }] });
    renderAt("/");
    await screen.findByText(en("home.noTasks"));
    expect(screen.queryByRole("button", { name: en("nav.upload") })).not.toBeInTheDocument();
    expect(screen.queryByTestId("to-verify")).not.toBeInTheDocument();
  });
});
