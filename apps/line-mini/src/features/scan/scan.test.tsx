import { screen } from "@testing-library/react";
import userEventLib from "@testing-library/user-event";
import { Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it } from "vitest";

import { useLanguage } from "../../stores/language";
import { PERSONAL, signedIn, USER } from "../../test/fixtures";
import { json, mockApi } from "../../test/mockApi";
import { renderWithProviders } from "../../test/render";
import { useTenantChoice } from "../tenants/useCurrentTenant";
import { ConfirmPage } from "./ConfirmPage";
import type { FileOut } from "./upload";

const userEvent = userEventLib.setup({ pointerEventsCheck: 0 });

const USAGE = {
  active: true,
  plan: { code: "kinder", period: "year", starts_at: "2026-01-01T00:00:00Z", ends_at: "2027-01-01T00:00:00Z" },
  month: { month: "2026-11-01", quota: 1000, used: 0, remaining: 1000 },
  free: { remaining: 0, expires_at: null, paused: false },
};

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

function scanApi(pending: FileOut[], over: Record<string, (r: Request) => Response | Promise<Response>> = {}) {
  let nextId = 0;
  return mockApi({
    "GET /api/v1/billing/usage": () => json(200, USAGE),
    "GET /api/v1/notifications/unread-count": () => json(200, { unread: 0 }),
    "GET /api/v1/files/pending": () => json(200, pending),
    "POST /api/v1/uploads": async (r) => {
      const body = (await r.json()) as { file_name: string };
      const id = `u${++nextId}`;
      return json(201, { ...file(id, body.file_name), status: "UPLOADING" });
    },
    ...over,
  });
}

function routes(path: string, element: React.ReactElement) {
  return (
    <Routes>
      <Route path={path} element={element} />
      <Route path="/scan/jobs/:id/progress" element={<div>progress page</div>} />
      <Route path="/history" element={<div>history page</div>} />
      <Route path="/plans" element={<div>plans page</div>} />
    </Routes>
  );
}


beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useLanguage.getState().setLang("en");
  useTenantChoice.getState().choose(null);
});

describe("confirm and start (FR-SYS-058)", () => {
  it("start creates jobs in order and clears pending (058-01)", async () => {
    const pending = [file("f1", "a.png"), file("f2", "b.png")];
    const api = scanApi(pending, {
      "POST /api/v1/ocr/jobs": async (r) => {
        const body = (await r.json()) as { file_id: string };
        pending.splice(pending.findIndex((f) => f.id === body.file_id), 1);
        return json(201, job(`j-${body.file_id}`, body.file_id));
      },
    });
    signedIn(USER, [PERSONAL]);
    renderWithProviders(routes("/scan/confirm", <ConfirmPage />), { route: "/scan/confirm?ids=f2,f1" });
    expect(await screen.findAllByText(/b\.png/)).not.toHaveLength(0);
    await userEvent.click(screen.getByRole("button", { name: "Start recognition" }));
    expect(await screen.findByText("history page")).toBeInTheDocument();
    const bodies = (await api.bodies("POST /api/v1/ocr/jobs")) as { file_id: string }[];
    expect(bodies.map((b) => b.file_id)).toEqual(["f2", "f1"]);
    expect(pending).toHaveLength(0);
  });

  it("one file goes to its progress page", async () => {
    scanApi([file("f1", "a.png")], {
      "POST /api/v1/ocr/jobs": () => json(201, job("j1", "f1")),
    });
    signedIn(USER, [PERSONAL]);
    renderWithProviders(routes("/scan/confirm", <ConfirmPage />), { route: "/scan/confirm?ids=f1" });
    await userEvent.click(await screen.findByRole("button", { name: "Start recognition" }));
    expect(await screen.findByText("progress page")).toBeInTheDocument();
  });

  it("quota exceeded shows remaining (058-02)", async () => {
    scanApi([file("f1", "c.pdf", 3)], {
      "POST /api/v1/ocr/jobs": () =>
        json(402, { code: "quota_exceeded", details: { available: 2 } }),
    });
    signedIn(USER, [PERSONAL]);
    renderWithProviders(routes("/scan/confirm", <ConfirmPage />), { route: "/scan/confirm?ids=f1" });
    await userEvent.click(await screen.findByRole("button", { name: "Start recognition" }));
    expect(await screen.findByText("Only 2 scans left — not enough for these pages.")).toBeInTheDocument();
    expect(screen.queryByText("progress page")).toBeNull();
  });

  it("plan expired offers the plans page", async () => {
    scanApi([file("f1", "a.png")], {
      "POST /api/v1/ocr/jobs": () => json(402, { code: "plan_expired" }),
    });
    signedIn(USER, [PERSONAL]);
    renderWithProviders(routes("/scan/confirm", <ConfirmPage />), { route: "/scan/confirm?ids=f1" });
    await userEvent.click(await screen.findByRole("button", { name: "Start recognition" }));
    await userEvent.click(await screen.findByRole("button", { name: "Open Plans" }));
    expect(await screen.findByText("plans page")).toBeInTheDocument();
  });

  it("retry after network loss sends the same key once (058-03)", async () => {
    let calls = 0;
    const keys = new Set<string>();
    const api = scanApi([file("f1", "a.png")], {
      "POST /api/v1/ocr/jobs": async (r) => {
        calls += 1;
        keys.add(((await r.json()) as { idempotency_key: string }).idempotency_key);
        if (calls === 1) throw new TypeError("network down");
        return json(201, job("j1", "f1"));
      },
    });
    signedIn(USER, [PERSONAL]);
    renderWithProviders(routes("/scan/confirm", <ConfirmPage />), { route: "/scan/confirm?ids=f1" });
    await userEvent.click(await screen.findByRole("button", { name: "Start recognition" }));
    expect(await screen.findByText(/Cannot reach the server/)).toBeInTheDocument();
    expect(api.count("POST /api/v1/ocr/jobs")).toBe(1); // no automatic retry
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(await screen.findByText("progress page")).toBeInTheDocument();
    expect(api.count("POST /api/v1/ocr/jobs")).toBe(2);
    expect(keys.size).toBe(1);
  });
});
