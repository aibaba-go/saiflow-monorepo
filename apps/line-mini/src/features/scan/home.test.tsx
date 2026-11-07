import { act, fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEventLib from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { HomePage } from "../../pages/HomePage";
import { useLanguage } from "../../stores/language";
import { ORG, PERSONAL, signedIn, USER } from "../../test/fixtures";
import { json, mockApi } from "../../test/mockApi";
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
    expect(await screen.findByRole("button", { name: "Camera" })).toBeEnabled();
    expect(screen.getByRole("button", { name: "Files" })).toBeEnabled();
    expect(screen.queryByText("Coming soon")).toBeNull();
    expect(await screen.findByText("invoice.png")).toBeInTheDocument();
    expect(screen.getByText("3 pages")).toBeInTheDocument();
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
    expect(screen.queryByRole("button", { name: "Camera" })).toBeNull();
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
