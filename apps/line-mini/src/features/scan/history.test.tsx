import { act, screen, waitFor } from "@testing-library/react";
import userEventLib from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { useTenantChoice } from "../tenants/useCurrentTenant";
import { useLanguage } from "../../stores/language";
import { ORG, PERSONAL, signedIn, USER } from "../../test/fixtures";
import { json, mockApi } from "../../test/mockApi";
import { renderWithProviders } from "../../test/render";
import { HistoryPage } from "./HistoryPage";

const userEvent = userEventLib.setup({ pointerEventsCheck: 0 });

const job = (n: number, stage: string, tenant = 70) => ({
  id: `j${tenant}-${n}`,
  file_id: `f${n}`,
  file_name: `doc-${tenant}-${n}.png`,
  page_count: 1,
  status: "SUCCEEDED",
  stage,
  error_code: null,
  engine: "textin",
  template_name: "Tax Invoice",
  created_at: "2026-11-06T00:00:00Z",
  confirmed_at: null,
});

/** GET /ocr/jobs answering from `all`, honouring stage, page and page_size. */
function jobsApi(byTenant: Record<string, ReturnType<typeof job>[]>) {
  return mockApi({
    "GET /api/v1/ocr/jobs": (r) => {
      const url = new URL(r.url);
      const tenant = r.headers.get("X-Tenant-Id") ?? "70";
      const stage = url.searchParams.get("stage");
      const page = Number(url.searchParams.get("page"));
      const size = Number(url.searchParams.get("page_size"));
      const rows = (byTenant[tenant] ?? []).filter((j) => !stage || j.stage === stage);
      return json(200, { items: rows.slice((page - 1) * size, page * size), total: rows.length, page, page_size: size });
    },
  });
}

function page() {
  return renderWithProviders(
    <Routes>
      <Route path="/history" element={<HistoryPage />} />
      <Route path="/scan/jobs/:id/result" element={<div>result page</div>} />
    </Routes>,
    { route: "/history" },
  );
}

beforeEach(() => {
  localStorage.clear();
  useLanguage.getState().setLang("en");
  useTenantChoice.getState().choose(null);
});

describe("history copied from main (FR-SYS-108, 117)", () => {
  it("history filter and open (108-01)", async () => {
    const api = jobsApi({ "70": [job(1, "CONFIRMED"), job(2, "VERIFYING"), job(3, "VERIFYING")] });
    signedIn(USER, [PERSONAL]);
    page();
    expect(await screen.findByText("doc-70-1.png")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Verifying" })); // main's stage chip
    await waitFor(() => expect(screen.queryByText("doc-70-1.png")).toBeNull());
    expect(screen.getByText("doc-70-2.png")).toBeInTheDocument();
    expect(api.calls.some((c) => new URL(c.url).searchParams.get("stage") === "VERIFYING")).toBe(true);
    await userEvent.click(screen.getByText("doc-70-2.png"));
    expect(await screen.findByText("result page")).toBeInTheDocument();
  });

  it("history loads 45 in pages (108-02)", async () => {
    const api = jobsApi({ "70": Array.from({ length: 45 }, (_, i) => job(i + 1, "VERIFYING")) });
    signedIn(USER, [PERSONAL]);
    page();
    await waitFor(() => expect(document.querySelectorAll("[data-job]")).toHaveLength(20));
        // no IntersectionObserver in jsdom: the fallback button stands in for scrolling
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(document.querySelectorAll("[data-job]")).toHaveLength(40));
    await userEvent.click(screen.getByRole("button", { name: "Load more" }));
    await waitFor(() => expect(document.querySelectorAll("[data-job]")).toHaveLength(45));
    const pages = api.calls.map((c) => new URL(c.url).searchParams);
    expect(pages.map((p) => p.get("page"))).toEqual(["1", "2", "3"]);
    expect(pages.every((p) => p.get("page_size") === "20")).toBe(true);
    expect(await screen.findByText("No more records")).toBeInTheDocument();
  });

  it("history resets on tenant switch", async () => {
    jobsApi({ "70": [job(1, "VERIFYING")], "5": [job(1, "CONFIRMED", 5)] });
    signedIn(USER, [PERSONAL, ORG]);
    page();
    expect(await screen.findByText("doc-70-1.png")).toBeInTheDocument();
    act(() => useTenantChoice.getState().choose(ORG.tenant_id));
    expect(await screen.findByText("doc-5-1.png")).toBeInTheDocument();
    expect(screen.queryByText("doc-70-1.png")).toBeNull();
  });

  it("search with stage (117-01)", async () => {
    const api = jobsApi({
      "70": [
        { ...job(1, "VERIFYING"), file_name: "inv-001.pdf" },
        { ...job(2, "CONFIRMED"), file_name: "inv-002.pdf" },
        { ...job(3, "VERIFYING"), file_name: "bill.pdf" },
      ],
    });
    api.set("GET /api/v1/ocr/jobs", (r) => {
      const url = new URL(r.url);
      const stage = url.searchParams.get("stage");
      const q = url.searchParams.get("q") ?? "";
      const all = [
        { ...job(1, "VERIFYING"), file_name: "inv-001.pdf" },
        { ...job(2, "CONFIRMED"), file_name: "inv-002.pdf" },
        { ...job(3, "VERIFYING"), file_name: "bill.pdf" },
      ].filter((j) => (!stage || j.stage === stage) && j.file_name.includes(q));
      return json(200, { items: all, total: all.length, page: 1, page_size: 20 });
    });
    signedIn(USER, [PERSONAL]);
    page();
    expect(await screen.findByText("bill.pdf")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Verifying" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Search file name" }), "inv");
    await waitFor(() => expect(screen.queryByText("bill.pdf")).toBeNull());
    expect(await screen.findByText("inv-001.pdf")).toBeInTheDocument();
    expect(screen.queryByText("inv-002.pdf")).toBeNull();
    const last = new URL(api.calls.at(-1)!.url).searchParams;
    expect([last.get("q"), last.get("stage")]).toEqual(["inv", "VERIFYING"]);
  });
});
