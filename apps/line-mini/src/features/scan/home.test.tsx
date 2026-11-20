import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEventLib from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { HomePage } from "../../pages/HomePage";
import { useLanguage } from "../../stores/language";
import { useSession } from "../../stores/session";
import { testAuth } from "../../test/auth";
import { GUEST, ORG, PERSONAL, signedIn, USER } from "../../test/fixtures";
import { json, mockApi, type MockApi } from "../../test/mockApi";
import { en } from "../../i18n/en";
import { th } from "../../i18n/th";
import { zh } from "../../i18n/zh";
import { renderWithProviders } from "../../test/render";
import { useTenantChoice } from "../tenants/useCurrentTenant";
import type { FileOut, JobOut } from "./api";

const userEvent = userEventLib.setup({ pointerEventsCheck: 0 });

const usage = (over: Record<string, unknown> = {}) => ({
  active: true,
  plan: { code: "starter", period: "month", starts_at: "2026-11-01T00:00:00Z", ends_at: "2027-06-01T00:00:00Z" },
  month: { month: "2026-11-01", quota: 5000, used: 120, remaining: 4880 },
  free: { remaining: 0, expires_at: null, paused: false },
  ...over,
});

const file = (id: string, name: string, pages = 1): FileOut => ({
  id,
  original_name: name,
  status: "READY",
  reject_reason: null,
  mime_type: "image/png",
  size_bytes: 1000,
  page_count: pages,
  expires_at: null,
  created_at: "2026-11-06T00:00:00Z",
});

const job = (n: number, stage: JobOut["stage"] = "VERIFYING"): JobOut => ({
  id: `j${n}`,
  file_id: `f${n}`,
  file_name: `doc-${n}.pdf`,
  page_count: 1,
  status: "SUCCEEDED",
  stage,
  error_code: null,
  engine: "textin",
  template_name: null,
  created_at: "2026-11-06T00:00:00Z",
  confirmed_at: null,
  returned: false,
});

type Handler = (r: Request) => Response | Promise<Response>;

function homeApi(pending: FileOut[] = [], over: Record<string, Handler> = {}, jobs: JobOut[] = []) {
  let next = 0;
  return mockApi({
    "GET /api/v1/billing/usage": () => json(200, usage()),
    "GET /api/v1/me/notifications": () => json(200, { items: [], unread_count: 0, next_before: null }),
    "GET /api/v1/files/pending": () => json(200, pending),
    "GET /api/v1/ocr/jobs": () => json(200, { items: jobs, total: jobs.length, page: 1, page_size: 10 }),
    "POST /api/v1/uploads": async (r) => {
      const body = (await r.json()) as { file_name: string };
      return json(201, { ...file(`u${++next}`, body.file_name), status: "UPLOADING" });
    },
    ...over,
  });
}

function page() {
  return renderWithProviders(
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/scan/confirm" element={<div>confirm page</div>} />
      <Route path="/scan/jobs/:id/result" element={<div>result page</div>} />
      <Route path="/plans" element={<div>plans page</div>} />
    </Routes>,
  );
}

const png = (name: string, size = 1000) => {
  const f = new File([new Uint8Array(8)], name, { type: "image/png" });
  Object.defineProperty(f, "size", { value: size });
  return f;
};

const ok = (id: string, name: string) => ({
  [`PUT /api/v1/uploads/${id}/content`]: () => json(200, file(id, name)),
  [`POST /api/v1/uploads/${id}/complete`]: () => json(200, file(id, name)),
});

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useLanguage.getState().setLang("en");
  useTenantChoice.getState().choose(null);
});

describe("scan home copied from main (FR-SYS-056, 057, 058, 109, 110, 111)", () => {
  it("home shows the scan entry and pending files (056-05)", async () => {
    homeApi([file("f1", "invoice.png"), file("f2", "bill.pdf", 3)]);
    signedIn(USER, [PERSONAL]);
    page();
    expect(await screen.findByRole("button", { name: "Scan a new document" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Files" })).toBeEnabled();
    expect(screen.queryByText("Coming soon")).toBeNull();
    expect(await screen.findByText("invoice.png")).toBeInTheDocument();
    expect(screen.getByText("3 pages")).toBeInTheDocument();
  });

  it("home shows the brand tagline with its accent in en, th and zh (FR-SYS-138)", async () => {
    homeApi();
    signedIn(USER, [PERSONAL]);
    page();
    for (const [lang, dict] of [["en", en], ["th", th], ["zh", zh]] as const) {
      act(() => useLanguage.getState().setLang(lang));
      const heading = await screen.findByRole("heading", { level: 1 });
      expect(heading).toHaveTextContent(dict["home.taglineLead"].trim());
      expect(within(heading).getByText(dict["home.taglineAccent"])).toBeInTheDocument();
      expect(screen.getByText(dict["home.taglineSub"])).toBeInTheDocument();
      expect(screen.getByText(dict["home.documentAi"])).toBeInTheDocument();
    }
  });

  it("three files, one too large: two pending, one error (057-01)", async () => {
    const pending: FileOut[] = [];
    const api = homeApi(pending, {
      ...ok("u1", "a.png"),
      ...ok("u2", "c.png"),
    });
    signedIn(USER, [PERSONAL]);
    page();
    fireEvent.change(await screen.findByTestId("scan-files"), {
      target: { files: [png("a.png"), png("big.png", 21 * 1024 * 1024), png("c.png")] },
    });
    await waitFor(() => expect(api.count("POST /api/v1/uploads/u2/complete")).toBe(1));
    const big = await screen.findByText("big.png");
    expect(within(big.closest("[data-upload]") as HTMLElement).getByRole("alert")).toHaveTextContent(
      "The file is larger than 20 MB.",
    );
    expect(api.count("POST /api/v1/uploads")).toBe(2); // the big one never left the phone
  });

  it("member without upload_ocr sees no scan entry (057-02)", async () => {
    homeApi();
    signedIn(USER, [PERSONAL, { ...ORG, permissions: ["verify_own"] }]);
    useTenantChoice.getState().choose(ORG.tenant_id);
    page();
    await screen.findByText(/4,880 \/ 5,000/);
    expect(screen.queryByRole("button", { name: "Scan a new document" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Import from URL" })).toBeNull();
  });

  it("quota banner and recent tasks (109-01)", async () => {
    homeApi([], {}, Array.from({ length: 10 }, (_, i) => job(i + 1)));
    signedIn(USER, [PERSONAL]);
    page();
    expect(await screen.findByText("Starter · 4,880 / 5,000 pages left this month")).toBeInTheDocument();
    await waitFor(() => expect(document.querySelectorAll("[data-job]")).toHaveLength(10));
    await userEvent.click(screen.getByText("doc-3.pdf"));
    expect(await screen.findByText("result page")).toBeInTheDocument();
  });

  it("expiring and expired banners (109-02)", async () => {
    const soon = new Date(Date.now() + 3 * 86_400_000).toISOString();
    const api = homeApi();
    api.set("GET /api/v1/billing/usage", () =>
      json(200, usage({ plan: { code: "starter", period: "month", starts_at: "2026-11-01T00:00:00Z", ends_at: soon } })),
    );
    signedIn(USER, [PERSONAL]);
    const view = page();
    expect(await screen.findByText("Expiring soon")).toBeInTheDocument();
    expect(screen.getByText(/3 days left/)).toBeInTheDocument();
    view.unmount();
    api.set("GET /api/v1/billing/usage", () => json(200, usage({ active: false })));
    page();
    expect(await screen.findByText("Your plan has expired")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "See renewal options" }));
    expect(await screen.findByText("plans page")).toBeInTheDocument();
  });

  it("cancel one and cancel all (110-01; Review Focus 5)", async () => {
    const aborted: string[] = [];
    const hold = (id: string) => (r: Request) =>
      new Promise<Response>((resolve) => {
        r.signal.addEventListener("abort", () => {
          aborted.push(id);
          resolve(json(499, { code: "cancelled" }));
        });
      });
    const api = homeApi([], {
      ...ok("u1", "a.png"),
      "PUT /api/v1/uploads/u2/content": hold("u2"),
      "PUT /api/v1/uploads/u3/content": hold("u3"),
      "DELETE /api/v1/files/u2": () => json(204, null),
      "DELETE /api/v1/files/u3": () => json(204, null),
    });
    signedIn(USER, [PERSONAL]);
    page();
    fireEvent.change(await screen.findByTestId("scan-files"), {
      target: { files: [png("a.png"), png("b.png"), png("c.png"), png("d.png")] },
    });
    await waitFor(() => expect(api.count("PUT /api/v1/uploads/u2/content")).toBe(1));
    await userEvent.click(screen.getByRole("button", { name: "Cancel b.png" }));
    await userEvent.click(await screen.findByRole("button", { name: "Cancel upload" }));
    await waitFor(() => expect(aborted).toContain("u2"));
    await waitFor(() => expect(api.count("DELETE /api/v1/files/u2")).toBe(1)); // half-made upload gone
    await waitFor(() => expect(api.count("PUT /api/v1/uploads/u3/content")).toBe(1));
    await userEvent.click(screen.getByRole("button", { name: "Cancel all unfinished uploads" }));
    await userEvent.click(await screen.findByRole("button", { name: /^Cancel all \(/ }));
    expect(await screen.findByText(/3 cancelled · 1 kept in Pending/)).toBeInTheDocument();
    expect(aborted).toEqual(["u2", "u3"]);
    expect(api.count("POST /api/v1/uploads")).toBe(3); // d.png was never created
  });

  it("retry failed only for retryable (110-02)", async () => {
    let puts = 0;
    const api = homeApi([], {
      "PUT /api/v1/uploads/u1/content": () => {
        puts += 1;
        return Promise.reject(new TypeError("network down"));
      },
      "DELETE /api/v1/files/u1": () => json(204, null),
      ...ok("u2", "a.png"),
    });
    signedIn(USER, [PERSONAL]);
    page();
    const doc = new File([new Uint8Array(4)], "notes.docx", { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
    fireEvent.change(await screen.findByTestId("scan-files"), { target: { files: [png("a.png"), doc] } });
    expect(await screen.findByRole("button", { name: "Retry failed" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry notes.docx" })).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "Retry failed" }));
    await waitFor(() => expect(api.count("POST /api/v1/uploads/u2/complete")).toBe(1));
    expect(puts).toBe(1);
  });

  it("import from URL (110-03)", async () => {
    const api = homeApi([], {
      "POST /api/v1/file-imports": async (r) => {
        const { url } = (await r.json()) as { url: string };
        if (url.includes("127.0.0.1")) return json(400, { code: "import_address_not_allowed", fields: ["url"] });
        return json(201, file("i1", "inv.pdf"));
      },
    });
    signedIn(USER, [PERSONAL]);
    page();
    await userEvent.click(await screen.findByRole("button", { name: "Import from URL" }));
    const box = screen.getByRole("textbox", { name: "Import from URL" });
    await userEvent.type(box, "http://127.0.0.1/a.pdf");
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText("This address is not allowed. Use a public link.")).toBeInTheDocument();
    await userEvent.clear(box);
    await userEvent.type(box, "https://example.com/inv.pdf");
    await userEvent.click(screen.getByRole("button", { name: "Import" }));
    expect(await screen.findByText("confirm page")).toBeInTheDocument();
    expect(await api.bodies("POST /api/v1/file-imports")).toEqual([
      { url: "http://127.0.0.1/a.pdf" },
      { url: "https://example.com/inv.pdf" },
    ]);
  });

  it("multi-select process and delete (111-01)", async () => {
    const pending = [file("a", "a.png"), file("b", "b.png"), file("c", "c.png")];
    const api = homeApi(pending, {
      "DELETE /api/v1/files/a": () => json(204, null),
      "DELETE /api/v1/files/b": () => json(204, null),
    });
    signedIn(USER, [PERSONAL]);
    page();
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select a.png" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Select b.png" }));
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Delete (2)" }));
    await userEvent.click(await screen.findByRole("button", { name: "Keep records" }));
    expect(api.count("DELETE /api/v1/files/a")).toBe(0);
    await userEvent.click(screen.getByRole("button", { name: "Delete (2)" }));
    await userEvent.click(await screen.findByRole("button", { name: "Delete 2" }));
    await waitFor(() => expect(api.count("DELETE /api/v1/files/b")).toBe(1));
    await userEvent.click(screen.getByRole("button", { name: "Select all" }));
    await userEvent.click(screen.getByRole("button", { name: "Process (3)" }));
    expect(await screen.findByText("confirm page")).toBeInTheDocument();
  });

  it("workspace switch reloads pending and recent", async () => {
    const api = homeApi([file("p", "personal.png")]);
    api.set("GET /api/v1/files/pending", (r) =>
      json(200, r.headers.get("X-Tenant-Id") === "5" ? [file("o", "org.png")] : [file("p", "personal.png")]),
    );
    signedIn(USER, [PERSONAL, ORG]);
    page();
    expect(await screen.findByText("personal.png")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: /Personal/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Siam Tools/ }));
    expect(await screen.findByText("org.png")).toBeInTheDocument();
    await act(async () => {});
    expect(screen.queryByText("personal.png")).toBeNull();
  });
});

/** A response that waits until opened. */
function gate() {
  let open!: () => void;
  const wait = new Promise<void>((r) => (open = r));
  return { wait, open };
}

const writes = (api: MockApi) =>
  api.calls.filter((c) => c.method !== "GET").map((c) => `${c.method} ${new URL(c.url).pathname}`);
const jobPage = (jobs: JobOut[], total = jobs.length) => json(200, { items: jobs, total, page: 1, page_size: 10 });
const refreshBtn = () => screen.getByRole("button", { name: "Refresh" });
const note = () => document.querySelector("[data-refresh-note]");
const DAY = 86_400_000;

describe("home manual refresh (FR-SYS-109)", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("re-reads usage, pending, recent, unread and the review count in place (109-03)", async () => {
    const reviewer = { ...ORG, permissions: ["upload_ocr", "review_l1"] };
    let round = 0;
    const api = homeApi([], {
      "GET /api/v1/billing/usage": () =>
        json(200, round ? usage({ month: { month: "2026-11-01", quota: 5000, used: 1000, remaining: 4000 } }) : usage()),
      "GET /api/v1/files/pending": () => json(200, round ? [file("n", "new.png")] : [file("o", "old.png")]),
      "GET /api/v1/ocr/jobs": () =>
        round ? jobPage(Array.from({ length: 10 }, (_, i) => job(101 + i)), 12) : jobPage([job(1), job(2)]),
      "GET /api/v1/me/notifications": () => json(200, { items: [], unread_count: round ? 3 : 0, next_before: null }),
      "GET /api/v1/reviews/summary": () => json(200, { l1: round ? 4 : 1, l2: null }),
    });
    signedIn(USER, [PERSONAL, reviewer]);
    useTenantChoice.getState().choose(ORG.tenant_id);
    page();
    expect(await screen.findByText("old.png")).toBeInTheDocument();
    expect(await screen.findByLabelText("1 to review")).toBeInTheDocument();
    expect(await screen.findByText("doc-2.pdf")).toBeInTheDocument();
    expect(screen.queryByLabelText("You have unread notifications")).toBeNull();
    round = 1;
    await userEvent.click(refreshBtn());
    expect(await screen.findByText("Home is up to date.")).toHaveAttribute("role", "status");
    expect(screen.getByText("Starter · 4,000 / 5,000 pages left this month")).toBeInTheDocument();
    expect(screen.getByText("new.png")).toBeInTheDocument();
    expect(screen.queryByText("old.png")).toBeNull();
    expect(document.querySelectorAll("[data-job]")).toHaveLength(10);
    expect(screen.getByText("doc-101.pdf")).toBeInTheDocument();
    expect(screen.getByLabelText("You have unread notifications")).toBeInTheDocument();
    expect(screen.getByLabelText("4 to review")).toBeInTheDocument();
    // same workspace; reads only, all tenant reads for organization O
    expect(screen.getByRole("button", { name: /Siam Tools/ })).toBeInTheDocument();
    expect(useTenantChoice.getState().id).toBe(ORG.tenant_id);
    expect(writes(api)).toEqual([]);
    const tenantReads = api.calls.filter((c) => new URL(c.url).pathname !== "/api/v1/me/notifications");
    expect(tenantReads.length).toBeGreaterThan(0);
    expect(tenantReads.every((c) => c.headers.get("X-Tenant-Id") === "5")).toBe(true);
    expect(api.count("GET /api/v1/reviews/summary")).toBe(2);
    expect(api.count("GET /api/v1/me/notifications")).toBe(2);
  });

  it("refresh moves the plan's date reference for the expiry notice (109-03)", async () => {
    const start = Date.parse("2026-11-10T00:00:00Z");
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(start);
    const ends = new Date(start + 10 * DAY).toISOString();
    homeApi([], {
      "GET /api/v1/billing/usage": () =>
        json(200, usage({ plan: { code: "starter", period: "month", starts_at: "2026-11-01T00:00:00Z", ends_at: ends } })),
    });
    signedIn(USER, [PERSONAL]);
    page();
    expect(await screen.findByText(/10 days left/)).toBeInTheDocument();
    expect(screen.queryByText("Expiring soon")).toBeNull();
    vi.setSystemTime(start + 7 * DAY);
    await userEvent.click(refreshBtn());
    expect(await screen.findByText(/3 days left/)).toBeInTheDocument();
    expect(screen.getByText("Expiring soon")).toBeInTheDocument();
  });

  it("repeated taps while a round runs start no second round (109-04)", async () => {
    const g = gate();
    let round = 0;
    const api = homeApi([], {
      "GET /api/v1/files/pending": async () => {
        if (round === 1) await g.wait;
        return json(200, [file("a", "a.png")]);
      },
    });
    signedIn(USER, [PERSONAL]);
    page();
    expect(await screen.findByText("a.png")).toBeInTheDocument();
    await waitFor(() => expect(api.count("GET /api/v1/ocr/jobs")).toBe(1));
    round = 1;
    const btn = refreshBtn();
    await userEvent.click(btn);
    expect(btn).toHaveAttribute("aria-busy", "true");
    expect(btn).toHaveAttribute("aria-disabled", "true");
    expect(btn).toHaveAccessibleName("Refreshing…");
    expect(note()).toHaveTextContent("Refreshing…");
    expect(note()).toHaveAttribute("role", "status");
    await userEvent.click(btn);
    await userEvent.click(btn);
    await act(async () => {});
    expect(api.count("GET /api/v1/files/pending")).toBe(2);
    expect(api.count("GET /api/v1/billing/usage")).toBe(2);
    expect(api.count("GET /api/v1/ocr/jobs")).toBe(2);
    round = 2;
    g.open();
    await waitFor(() => expect(btn).toHaveAttribute("aria-busy", "false"));
    expect(btn).toHaveAccessibleName("Refresh");
    expect(btn).toHaveAttribute("aria-disabled", "false");
    await userEvent.click(btn);
    await waitFor(() => expect(api.count("GET /api/v1/files/pending")).toBe(3));
  });

  it("a failed pending read keeps the old list and says so; the next refresh updates it (109-05)", async () => {
    let mode: "first" | "down" | "up" = "first";
    const api = homeApi([], {
      "GET /api/v1/billing/usage": () =>
        json(200, mode === "first" ? usage() : usage({ month: { month: "2026-11-01", quota: 5000, used: 2000, remaining: 3000 } })),
      "GET /api/v1/files/pending": () =>
        mode === "down"
          ? Promise.reject(new TypeError("offline"))
          : json(200, mode === "first" ? [file("x", "x.png")] : [file("z", "z.png")]),
      "GET /api/v1/ocr/jobs": () => jobPage([job(mode === "first" ? 1 : 2)]),
    });
    signedIn(USER, [PERSONAL]);
    page();
    expect(await screen.findByText("x.png")).toBeInTheDocument();
    expect(await screen.findByText("doc-1.pdf")).toBeInTheDocument();
    mode = "down";
    await userEvent.click(refreshBtn());
    const alert = await screen.findByText(en["home.refreshPartial"]);
    expect(alert).toHaveAttribute("role", "alert");
    expect(screen.getByText("x.png")).toBeInTheDocument(); // old pending kept
    expect(screen.getByText("Starter · 3,000 / 5,000 pages left this month")).toBeInTheDocument();
    expect(screen.getByText("doc-2.pdf")).toBeInTheDocument();
    expect(refreshBtn()).toHaveAttribute("aria-busy", "false");
    mode = "up";
    await userEvent.click(refreshBtn());
    expect(await screen.findByText("z.png")).toBeInTheDocument();
    expect(await screen.findByText("Home is up to date.")).toBeInTheDocument();
    expect(screen.queryByText(en["home.refreshPartial"])).toBeNull();
    expect(screen.queryByText("x.png")).toBeNull();
    expect(writes(api)).toEqual([]); // nothing deleted, no OCR started
  });

  it("a 401 goes through the session expiry handling, not a refresh notice (109 auth)", async () => {
    testAuth();
    let expire = false;
    const api = homeApi([], {
      "GET /api/v1/files/pending": () => {
        if (!expire) return json(200, [file("x", "x.png")]);
        expire = false;
        return json(401, { code: "unauthenticated" });
      },
      "GET /api/v1/me": () => json(401, { code: "unauthenticated" }),
      "POST /api/v1/auth/guest": () => json(200, GUEST),
    });
    signedIn(USER, [PERSONAL]);
    page();
    expect(await screen.findByText("x.png")).toBeInTheDocument();
    expire = true;
    await userEvent.click(refreshBtn());
    await waitFor(() => expect(useSession.getState().notice).toBe("err.session_expired"));
    expect(useSession.getState().me?.kind).toBe("guest");
    expect(api.count("GET /api/v1/me")).toBe(1);
    expect(screen.queryByText(en["home.refreshPartial"])).toBeNull();
    expect(screen.queryByText("Home is up to date.")).toBeNull();
  });

  it("guest refreshes its trial tenant only; no notifications or review summary (109-07)", async () => {
    const api = homeApi([file("g", "guest.png")]);
    signedIn(GUEST, []);
    page();
    expect(await screen.findByText("guest.png")).toBeInTheDocument();
    await waitFor(() => expect(api.count("GET /api/v1/ocr/jobs")).toBe(1));
    await userEvent.click(refreshBtn());
    expect(await screen.findByText("Home is up to date.")).toBeInTheDocument();
    expect(api.count("GET /api/v1/files/pending")).toBe(2);
    expect(api.count("GET /api/v1/billing/usage")).toBe(2);
    expect(api.count("GET /api/v1/ocr/jobs")).toBe(2);
    expect(api.count("GET /api/v1/me/notifications")).toBe(0);
    expect(api.count("GET /api/v1/reviews/summary")).toBe(0);
  });

  it("a member without review permission refreshes home and own notifications, not the summary (109-07)", async () => {
    const api = homeApi([file("o", "org.png")]);
    signedIn(USER, [PERSONAL, ORG]);
    useTenantChoice.getState().choose(ORG.tenant_id);
    page();
    expect(await screen.findByText("org.png")).toBeInTheDocument();
    await waitFor(() => expect(api.count("GET /api/v1/me/notifications")).toBe(1));
    await userEvent.click(refreshBtn());
    expect(await screen.findByText("Home is up to date.")).toBeInTheDocument();
    expect(api.count("GET /api/v1/files/pending")).toBe(2);
    expect(api.count("GET /api/v1/me/notifications")).toBe(2);
    expect(api.count("GET /api/v1/reviews/summary")).toBe(0);
  });

  it("no current tenant: refresh sends no request", async () => {
    const api = homeApi();
    useSession.setState({ me: null, tenants: [], status: "ready" });
    page();
    const btn = await screen.findByRole("button", { name: "Refresh" });
    expect(btn).toHaveAttribute("aria-disabled", "true");
    await userEvent.click(btn);
    await act(async () => {});
    expect(api.calls).toHaveLength(0);
    expect(note()).toBeNull();
  });

  it("uploads, URL input, workspace and still-pending choices survive a refresh (109-06)", async () => {
    const g = gate();
    let round = 0;
    const api = homeApi([], {
      "GET /api/v1/files/pending": () =>
        json(200, round ? [file("x", "x.png")] : [file("x", "x.png"), file("y", "y.png")]),
      "PUT /api/v1/uploads/u1/content": async () => {
        await g.wait;
        return json(200, file("u1", "a.png"));
      },
      "POST /api/v1/uploads/u1/complete": () => json(200, file("u1", "a.png")),
      ...ok("u2", "b.png"),
    });
    signedIn(USER, [PERSONAL]);
    page();
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select x.png" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Select y.png" }));
    expect(screen.getByText("2 selected")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Import from URL" }));
    await userEvent.type(screen.getByRole("textbox", { name: "Import from URL" }), "https://example.com/a.pdf");
    fireEvent.change(screen.getByTestId("scan-files"), { target: { files: [png("a.png"), png("b.png")] } });
    await waitFor(() => expect(api.count("PUT /api/v1/uploads/u1/content")).toBe(1));
    round = 1;
    await userEvent.click(refreshBtn()); // allowed while uploading
    expect(await screen.findByText("Home is up to date.")).toBeInTheDocument();
    expect(screen.queryByRole("checkbox", { name: "Select y.png" })).toBeNull();
    expect(screen.getByRole("checkbox", { name: "Select x.png" })).toBeChecked();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Process (1)" })).toBeEnabled();
    expect(screen.getByRole("textbox", { name: "Import from URL" })).toHaveValue("https://example.com/a.pdf");
    expect(screen.getByRole("progressbar", { name: "a.png" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Personal/ })).toBeDisabled(); // still no switch while uploading
    expect(api.count("POST /api/v1/uploads")).toBe(1); // B still waiting, not started twice
    g.open();
    await waitFor(() => expect(api.count("POST /api/v1/uploads/u2/complete")).toBe(1));
    expect(api.count("POST /api/v1/uploads")).toBe(2);
    expect(api.count("PUT /api/v1/uploads/u1/content")).toBe(1);
    expect(writes(api).filter((w) => !w.includes("/uploads"))).toEqual([]);
  });

  it("a choice that left Pending is dropped and stays unchecked if it comes back (109-06)", async () => {
    let list = [file("x", "x.png"), file("y", "y.png")];
    homeApi([], { "GET /api/v1/files/pending": () => json(200, list) });
    signedIn(USER, [PERSONAL]);
    page();
    await userEvent.click(await screen.findByRole("checkbox", { name: "Select x.png" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Select y.png" }));
    list = [file("x", "x.png")];
    await userEvent.click(refreshBtn());
    await waitFor(() => expect(screen.queryByText("y.png")).toBeNull());
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Delete (1)" })).toBeEnabled();
    await waitFor(() => expect(refreshBtn()).toHaveAttribute("aria-busy", "false"));
    list = [file("x", "x.png"), file("y", "y.png")];
    await userEvent.click(refreshBtn());
    expect(await screen.findByRole("checkbox", { name: "Select y.png" })).not.toBeChecked();
    expect(screen.getByText("1 selected")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Process (1)" }));
    expect(await screen.findByText("confirm page")).toBeInTheDocument();
  });

  it("after a workspace switch, the old tenant's late answers change nothing (109-08)", async () => {
    const g = gate();
    let round = 0;
    const api = homeApi([]);
    const org = (r: Request) => r.headers.get("X-Tenant-Id") === "5";
    api.set("GET /api/v1/files/pending", async (r) => {
      if (org(r)) return json(200, [file("o", "org.png")]);
      if (round) {
        await g.wait;
        return json(200, [file("s", "stale.png")]);
      }
      return json(200, [file("p", "personal.png")]);
    });
    api.set("GET /api/v1/ocr/jobs", async (r) => {
      if (org(r)) return jobPage([job(5)]);
      if (round) {
        await g.wait;
        return json(500, { code: "internal" });
      }
      return jobPage([job(1)]);
    });
    signedIn(USER, [PERSONAL, ORG]);
    page();
    expect(await screen.findByText("personal.png")).toBeInTheDocument();
    round = 1;
    await userEvent.click(refreshBtn());
    await userEvent.click(screen.getByRole("button", { name: /Personal/ }));
    await userEvent.click(await screen.findByRole("menuitem", { name: /Siam Tools/ }));
    expect(await screen.findByText("org.png")).toBeInTheDocument();
    expect(await screen.findByText("doc-5.pdf")).toBeInTheDocument();
    await act(async () => {
      g.open();
      await new Promise((r) => setTimeout(r, 50));
    });
    expect(screen.queryByText("stale.png")).toBeNull();
    expect(screen.queryByText("personal.png")).toBeNull();
    expect(screen.getByText("org.png")).toBeInTheDocument();
    expect(screen.getByText("doc-5.pdf")).toBeInTheDocument();
    expect(note()).toBeNull();
    expect(screen.queryByText(en["home.refreshPartial"])).toBeNull();
    expect(refreshBtn()).toHaveAttribute("aria-busy", "false");
  });

  it.each([
    ["th", th],
    ["zh", zh],
  ] as const)("refresh, waiting and failure copy in %s (109-09)", async (lang, dict) => {
    useLanguage.getState().setLang(lang);
    const g = gate();
    let round = 0;
    homeApi([], {
      "GET /api/v1/files/pending": async () => {
        if (!round) return json(200, []);
        await g.wait;
        return Promise.reject(new TypeError("offline"));
      },
    });
    signedIn(USER, [PERSONAL]);
    page();
    const btn = await screen.findByRole("button", { name: dict["home.refresh"] });
    expect(btn).toHaveClass("refresh-btn");
    // beside the bell in the header actions, not on top of it
    expect(btn.parentElement).toContainElement(screen.getByRole("button", { name: dict["notify.title"] }));
    round = 1;
    await userEvent.click(btn);
    expect(btn).toHaveAccessibleName(dict["home.refreshing"]);
    expect(note()).toHaveTextContent(dict["home.refreshing"]);
    g.open();
    expect(await screen.findByText(dict["home.refreshPartial"])).toHaveAttribute("role", "alert");
    expect(btn).toHaveAccessibleName(dict["home.refresh"]);
  });
});
