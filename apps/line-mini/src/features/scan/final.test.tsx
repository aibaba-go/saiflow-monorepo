import { screen, waitFor } from "@testing-library/react";
import userEventLib from "@testing-library/user-event";
import { act } from "react";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLanguage } from "../../stores/language";
import { testAuth } from "../../test/auth";
import { fakeLiff } from "../../test/fakeLiff";
import { GUEST, ORG, PERSONAL, signedIn, USER } from "../../test/fixtures";
import { json, mockApi } from "../../test/mockApi";
import { renderWithProviders } from "../../test/render";
import { useTenantChoice } from "../tenants/useCurrentTenant";
import { FinalResultPage } from "./FinalResultPage";
import { ResultPage } from "./ResultPage";

const userEvent = userEventLib.setup({ pointerEventsCheck: 0 });
const JOB = "/api/v1/ocr/jobs/j1";

const job = (stage: string) => ({
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
});

const GROUPS = [
  {
    key: "document",
    name: "Document",
    items: [
      { kind: "field", key: "invoice_no", name: "Tax Invoice No.", type: "string", required: true },
      { kind: "field", key: "invoice_date", name: "Date", type: "date", required: true },
    ],
  },
];

const result = (version: number, structured: unknown, confirmed = false) => ({
  version,
  structured,
  template: { template_version_id: 3, name: "Tax Invoice", groups: GROUPS },
  missing_required: [],
  mapping: null,
  confirmed,
});

function pages(route: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/scan/jobs/:id/result" element={<ResultPage />} />
      <Route path="/scan/jobs/:id/final" element={<FinalResultPage />} />
      <Route path="/plans" element={<div>plans page</div>} />
    </Routes>,
    { route },
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useLanguage.getState().setLang("en");
  useTenantChoice.getState().choose(null);
});

describe("confirm (FR-SYS-106)", () => {
  it("guest confirm after login keeps the edit (106-01)", async () => {
    const liff = testAuth(fakeLiff({ loggedIn: false }));
    let stored = result(1, { document: { invoice_no: "IV1", invoice_date: "2026-10-01" } });
    const api = mockApi({
      [`GET ${JOB}`]: () => json(200, job("VERIFYING")),
      [`GET ${JOB}/result`]: () => json(200, stored),
      [`PATCH ${JOB}/result`]: async (r) => {
        const body = (await r.json()) as { structured: unknown; confirm: boolean };
        stored = result(stored.version + 1, body.structured, body.confirm) as typeof stored;
        return json(200, stored);
      },
    });
    signedIn(GUEST, []);
    pages("/scan/jobs/j1/result");
    const no = await screen.findByRole("textbox", { name: "Tax Invoice No." });
    await userEvent.clear(no);
    await userEvent.type(no, "IV9");
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(liff.login).toHaveBeenCalled()); // sent to LINE login
    const [draft] = (await api.bodies(`PATCH ${JOB}/result`)) as { confirm: boolean; structured: { document: { invoice_no: string } } }[];
    expect(draft!.confirm).toBe(false); // the edit was saved before leaving
    expect(draft!.structured.document.invoice_no).toBe("IV9");
    // back from login and registration: the page confirms by itself
    act(() => signedIn(USER, [PERSONAL]));
    expect(await screen.findByText("This result is confirmed.")).toBeInTheDocument();
    const bodies = (await api.bodies(`PATCH ${JOB}/result`)) as { confirm: boolean; structured: { document: { invoice_no: string } } }[];
    expect(bodies.at(-1)!.confirm).toBe(true);
    expect(bodies.at(-1)!.structured.document.invoice_no).toBe("IV9");
  });

  it("missing required scrolls and marks (106-02)", async () => {
    const scroll = vi.fn();
    Element.prototype.scrollIntoView = scroll;
    mockApi({
      [`GET ${JOB}`]: () => json(200, job("VERIFYING")),
      [`GET ${JOB}/result`]: () => json(200, result(1, { document: { invoice_no: "IV1", invoice_date: "" } })),
      [`PATCH ${JOB}/result`]: () =>
        json(422, { code: "required_missing", fields: ["structured.document.invoice_date"] }),
    });
    signedIn(USER, [PERSONAL]);
    pages("/scan/jobs/j1/result");
    await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await waitFor(() => {
      const date = document.querySelector('[data-path="document.invoice_date"]') as HTMLElement;
      expect(date.className).toContain("result__field--missing");
    });
    await waitFor(() => expect(scroll).toHaveBeenCalled());
    expect(scroll.mock.contexts[0]).toBe(document.querySelector('[data-path="document.invoice_date"]'));
    expect(screen.queryByText("This result is confirmed.")).toBeNull();
  });

  it("an expired plan offers the plans page", async () => {
    mockApi({
      [`GET ${JOB}`]: () => json(200, job("VERIFYING")),
      [`GET ${JOB}/result`]: () => json(200, result(1, { document: { invoice_no: "IV1", invoice_date: "x" } })),
      [`PATCH ${JOB}/result`]: () => json(402, { code: "plan_expired" }),
    });
    signedIn(USER, [PERSONAL]);
    pages("/scan/jobs/j1/result");
    await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await userEvent.click(await screen.findByRole("button", { name: "Open Plans" }));
    expect(await screen.findByText("plans page")).toBeInTheDocument();
  });
});

describe("final result and export (FR-SYS-107)", () => {
  const finalApi = () =>
    mockApi({
      [`GET ${JOB}`]: () => json(200, job("CONFIRMED")),
      [`GET ${JOB}/result`]: () => json(200, result(2, { document: { invoice_no: "IV1", invoice_date: "2026-10-01" } }, true)),
      [`POST ${JOB}/exports`]: () => json(201, { id: "e1", expires_at: "2026-11-07T00:00:00Z" }),
      "POST /api/v1/exports/e1/ticket": () => json(200, { url: "/api/v1/export-downloads/abc.def" }),
    });

  it("export in LINE opens a ticket externally (107-01)", async () => {
    const liff = testAuth(fakeLiff({ loggedIn: true, inClient: true }));
    const api = finalApi();
    useLanguage.getState().setLang("th");
    signedIn(USER, [PERSONAL]);
    pages("/scan/jobs/j1/final");
    expect(await screen.findByText("IV1")).toBeInTheDocument(); // read only
    expect(screen.queryByRole("textbox")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "ส่งออก Excel" }));
    await waitFor(() => expect(liff.openWindow).toHaveBeenCalled());
    const arg = liff.openWindow.mock.calls[0]![0] as { url: string; external: boolean };
    expect(arg.external).toBe(true);
    expect(arg.url).toMatch(/\/api\/v1\/export-downloads\/abc\.def$/);
    expect(await api.bodies(`POST ${JOB}/exports`)).toEqual([{ language: "th" }]);
  });

  it("no export permission hides button (107-02)", async () => {
    testAuth();
    finalApi();
    signedIn(USER, [PERSONAL, { ...ORG, permissions: ["upload_ocr", "verify_own"] }]);
    useTenantChoice.getState().choose(ORG.tenant_id);
    pages("/scan/jobs/j1/final");
    expect(await screen.findByText("IV1")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Export Excel" })).toBeNull();
  });
});
