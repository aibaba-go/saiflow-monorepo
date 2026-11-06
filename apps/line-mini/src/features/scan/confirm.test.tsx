import { act, screen, waitFor } from "@testing-library/react";
import userEventLib from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLanguage } from "../../stores/language";
import { ORG, PERSONAL, signedIn, USER } from "../../test/fixtures";
import { json, mockApi } from "../../test/mockApi";
import { renderWithProviders } from "../../test/render";
import { useTenantChoice } from "../tenants/useCurrentTenant";
import type { FileOut } from "./api";
import { ConfirmPage } from "./ConfirmPage";

const userEvent = userEventLib.setup({ pointerEventsCheck: 0 });

const file = (id: string, name: string, pages = 1): FileOut => ({
  id,
  original_name: name,
  status: "READY",
  reject_reason: null,
  mime_type: "application/pdf",
  size_bytes: 1000,
  page_count: pages,
  expires_at: null,
  created_at: "2026-11-06T00:00:00Z",
});

const job = (id: string, fileId: string) => ({
  id,
  file_id: fileId,
  file_name: "x",
  page_count: 1,
  status: "QUEUED",
  stage: "OCR_PROCESSING",
  error_code: null,
  engine: null,
  template_name: null,
  created_at: "2026-11-06T00:00:00Z",
  confirmed_at: null,
});

type Handler = (r: Request) => Response | Promise<Response>;

function confirmApi(files: FileOut[], over: Record<string, Handler> = {}) {
  const routes: Record<string, Handler> = { "GET /api/v1/files/pending": () => json(200, files) };
  for (const f of files) {
    routes[`GET /api/v1/files/${f.id}`] = () => json(200, f);
    routes[`GET /api/v1/files/${f.id}/pages/1/preview`] = () => new Response(new Blob(["x"]), { status: 200 });
    routes[`GET /api/v1/files/${f.id}/pages/2/preview`] = () => new Response(new Blob(["x"]), { status: 200 });
  }
  return mockApi({ ...routes, ...over });
}

function page(ids: string) {
  return renderWithProviders(
    <Routes>
      <Route path="/scan/confirm" element={<ConfirmPage />} />
      <Route path="/scan/jobs/:id/progress" element={<div>progress page</div>} />
      <Route path="/" element={<div>home page</div>} />
      <Route path="/plans" element={<div>plans page</div>} />
    </Routes>,
    { route: `/scan/confirm?ids=${ids}` },
  );
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useLanguage.getState().setLang("en");
  useTenantChoice.getState().choose(null);
  signedIn(USER, [PERSONAL, ORG]);
  vi.stubGlobal("URL", Object.assign(URL, { createObjectURL: () => "blob:x", revokeObjectURL: () => {} }));
});

describe("confirm page copied from main (FR-SYS-058, 112, 113)", () => {
  it("start creates jobs in order and returns home (058-01)", async () => {
    const api = confirmApi([file("f1", "a.pdf"), file("f2", "b.pdf")], {
      "POST /api/v1/ocr/jobs": async (r) => {
        const body = (await r.json()) as { file_id: string };
        return json(201, job(`j-${body.file_id}`, body.file_id));
      },
    });
    page("f2,f1");
    await userEvent.click(await screen.findByRole("button", { name: "Start processing (2 files)" }));
    expect(await screen.findByText("home page")).toBeInTheDocument();
    const bodies = (await api.bodies("POST /api/v1/ocr/jobs")) as { file_id: string }[];
    expect(bodies.map((b) => b.file_id)).toEqual(["f2", "f1"]);
  });

  it("one file goes to its progress page", async () => {
    confirmApi([file("f1", "a.pdf")], { "POST /api/v1/ocr/jobs": () => json(201, job("j1", "f1")) });
    page("f1");
    await userEvent.click(await screen.findByRole("button", { name: "Start processing" }));
    expect(await screen.findByText("progress page")).toBeInTheDocument();
  });

  it("quota exceeded shows remaining (058-02)", async () => {
    confirmApi([file("f1", "c.pdf", 3)], {
      "POST /api/v1/ocr/jobs": () => json(402, { code: "quota_exceeded", details: { available: 2 } }),
    });
    page("f1");
    await userEvent.click(await screen.findByRole("button", { name: "Start processing" }));
    expect(await screen.findByText("Only 2 scans left — not enough for these pages.")).toBeInTheDocument();
    expect(screen.queryByText("progress page")).toBeNull();
  });

  it("plan expired offers the plans page", async () => {
    confirmApi([file("f1", "a.pdf")], { "POST /api/v1/ocr/jobs": () => json(402, { code: "plan_expired" }) });
    page("f1");
    await userEvent.click(await screen.findByRole("button", { name: "Start processing" }));
    await userEvent.click(await screen.findByRole("button", { name: "Open Plans" }));
    expect(await screen.findByText("plans page")).toBeInTheDocument();
  });

  it("retry after network loss sends the same key once (058-03)", async () => {
    let calls = 0;
    const keys = new Set<string>();
    const api = confirmApi([file("f1", "a.pdf")], {
      "POST /api/v1/ocr/jobs": async (r) => {
        calls += 1;
        keys.add(((await r.json()) as { idempotency_key: string }).idempotency_key);
        if (calls === 1) throw new TypeError("network down");
        return json(201, job("j1", "f1"));
      },
    });
    page("f1");
    await userEvent.click(await screen.findByRole("button", { name: "Start processing" }));
    expect(await screen.findByText(/Cannot reach the server/)).toBeInTheDocument();
    expect(api.count("POST /api/v1/ocr/jobs")).toBe(1); // no automatic retry
    await userEvent.click(screen.getByRole("button", { name: "Start processing" }));
    expect(await screen.findByText("progress page")).toBeInTheDocument();
    expect(keys.size).toBe(1);
  });

  it("file by file with prev and next (112)", async () => {
    confirmApi([file("f1", "a.pdf"), file("f2", "b.pdf"), file("f3", "c.pdf")]);
    page("f1,f2,f3");
    expect(await screen.findByText("File 1 of 3")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Previous file" })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Next file" }));
    expect(screen.getByText("File 2 of 3")).toBeInTheDocument();
    expect(await screen.findByText("b.pdf")).toBeInTheDocument();
  });

  it("partial start continues with the rest (112-01)", async () => {
    let n = 0;
    const api = confirmApi([file("f1", "a.pdf"), file("f2", "b.pdf"), file("f3", "c.pdf")], {
      "POST /api/v1/ocr/jobs": async (r) => {
        const body = (await r.json()) as { file_id: string };
        n += 1;
        if (n === 2) return json(402, { code: "quota_exceeded", details: { available: 0 } });
        return json(201, job(`j-${body.file_id}`, body.file_id));
      },
    });
    page("f1,f2,f3");
    await userEvent.click(await screen.findByRole("button", { name: "Start processing (3 files)" }));
    expect(await screen.findByText(/Only 0 scans left/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Start processing (2 files)" }));
    expect(await screen.findByText("home page")).toBeInTheDocument();
    const bodies = (await api.bodies("POST /api/v1/ocr/jobs")) as { file_id: string }[];
    expect(bodies.map((b) => b.file_id)).toEqual(["f1", "f2", "f2", "f3"]); // f1 not created twice
  });

  it("tenant changed shows the notice and disables start (112-02)", async () => {
    confirmApi([file("f1", "a.pdf")]);
    page("f1");
    const start = await screen.findByRole("button", { name: "Start processing" });
    act(() => useTenantChoice.getState().choose(ORG.tenant_id));
    expect(await screen.findByText(/workspace changed/)).toBeInTheDocument();
    expect(start).toBeDisabled();
  });

  it("an unavailable file blocks start", async () => {
    const api = confirmApi([file("f1", "a.pdf")]);
    api.set("GET /api/v1/files/gone", () => json(404, { code: "not_found" }));
    page("f1,gone");
    expect(await screen.findByText(/Some selected files are unavailable/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Start processing/ })).toBeDisabled();
  });

  it("viewer zoom and next page (113-01)", async () => {
    confirmApi([file("f1", "a.pdf", 3)]);
    page("f1");
    await userEvent.click(await screen.findByRole("button", { name: "Tap to zoom" }));
    const viewer = await screen.findByRole("dialog");
    expect(viewer).toHaveTextContent("1 / 3");
    await userEvent.click(screen.getByRole("button", { name: "Zoom in" }));
    expect(screen.getByRole("button", { name: "Reset zoom" })).toHaveTextContent("160%");
    await userEvent.click(screen.getByRole("button", { name: "Next page" }));
    await waitFor(() => expect(viewer).toHaveTextContent("2 / 3"));
    await userEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});
