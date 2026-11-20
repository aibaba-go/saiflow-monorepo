import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useLanguage } from "../stores/language";
import { en, renderAt, signedIn, userEvent } from "../test/app";
import { ORG, PERSONAL } from "../test/fixtures";
import { json } from "../test/mockApi";
import { useTenantChoice } from "../tenants/useCurrentTenant";

const file = (id: string, name: string, pages = 1) => ({
  id,
  original_name: name,
  page_count: pages,
  status: "READY",
  mime_type: "image/png",
  size_bytes: 10,
  reject_reason: null,
  expires_at: null,
  created_at: "2026-11-07T01:00:00Z",
});

const job = (id: string, stage: string, extra: Record<string, unknown> = {}) => ({
  id,
  file_id: `f-${id}`,
  file_name: `${id}.png`,
  page_count: 1,
  status: stage === "OCR_FAILED" ? "FAILED" : "PROCESSING",
  stage,
  error_code: stage === "OCR_FAILED" ? "VENDOR_TIMEOUT" : null,
  engine: "textin",
  template_name: null,
  created_at: "2026-11-07T01:00:00Z",
  confirmed_at: null,
  review_level: null,
  ...extra,
});

const page = (items: unknown[]) => json(200, { items, total: items.length, page: 1, page_size: 20 });

/** Jobs by stage for the recognition status list. */
function jobsBy(byStage: Record<string, unknown[]>) {
  return (r: Request) => page(byStage[new URL(r.url).searchParams.get("stage") ?? ""] ?? []);
}

function uploadRoutes(pending: { current: unknown[] }, fail = new Set<string>()) {
  let n = 0;
  return {
    "POST /api/v1/uploads": async (r: Request) => {
      const body = (await r.json()) as { file_name: string };
      n += 1;
      if (fail.has(body.file_name)) return json(500, { code: "internal" });
      return json(201, { ...file(`u${n}`, body.file_name), status: "UPLOADING" });
    },
    "PUT /api/v1/uploads/u1/content": () => json(204, null),
    "PUT /api/v1/uploads/u2/content": () => json(204, null),
    "PUT /api/v1/uploads/u3/content": () => json(204, null),
    "POST /api/v1/uploads/u1/complete": () => {
      pending.current = [...pending.current, file("u1", "a.png")];
      return json(200, file("u1", "a.png"));
    },
    "POST /api/v1/uploads/u2/complete": () => {
      pending.current = [...pending.current, file("u2", "b.png")];
      return json(200, file("u2", "b.png"));
    },
    "POST /api/v1/uploads/u3/complete": () => json(200, file("u3", "c.png")),
    "GET /api/v1/files/pending": () => json(200, pending.current),
    "DELETE /api/v1/files/u1": () => json(204, null),
    "DELETE /api/v1/files/u2": () => json(204, null),
  };
}

async function drop(files: File[]) {
  const input = document.querySelector('input[type="file"]') as HTMLInputElement;
  await userEvent.upload(input, files);
}

beforeEach(() => {
  localStorage.clear();
  sessionStorage.clear();
  useTenantChoice.getState().reset();
  useLanguage.getState().setLang("en");
});

describe("upload (FR-SYS-127)", () => {
  it("drop rejects txt and uploads pngs (127-01)", async () => {
    const pending = { current: [] as unknown[] };
    signedIn({ ...uploadRoutes(pending), "GET /api/v1/ocr/jobs": jobsBy({}) });
    renderAt("/upload");
    await screen.findByTestId("page-upload");
    await drop([
      new File(["x"], "a.png", { type: "image/png" }),
      new File(["x"], "b.png", { type: "image/png" }),
      new File(["x"], "notes.txt", { type: "text/plain" }),
    ]);
    expect(await screen.findByText(en("err.unsupported_format"))).toBeInTheDocument();
    const list = await screen.findByTestId("pending-list");
    await waitFor(() => expect(within(list).getByText("b.png")).toBeInTheDocument());
    expect(within(list).getByText("a.png")).toBeInTheDocument();
  });

  it("cancel and retry (127-02)", async () => {
    const pending = { current: [] as unknown[] };
    let release: () => void = () => {};
    const routes = uploadRoutes(pending, new Set(["b.png"]));
    signedIn({
      ...routes,
      "PUT /api/v1/uploads/u1/content": () => new Promise<Response>((r) => (release = () => r(json(204, null)))),
      "GET /api/v1/ocr/jobs": jobsBy({}),
    });
    renderAt("/upload");
    await screen.findByTestId("page-upload");
    await drop([new File(["x"], "a.png", { type: "image/png" }), new File(["x"], "b.png", { type: "image/png" })]);
    const queue = await screen.findByTestId("upload-queue");
    const rowA = (await within(queue).findByText("a.png")).closest("tr") as HTMLElement;
    await userEvent.click(within(rowA).getByRole("button", { name: en("ocr.cancel") }));
    release();
    const rowB = (await within(queue).findByText("b.png")).closest("tr") as HTMLElement;
    await waitFor(() => expect(within(rowB).getByRole("button", { name: en("common.retry") })).toBeInTheDocument());
    // a cancelled file stays in the queue marked "Cancelled" (AC-127-02, final review 6)
    const rowA2 = within(queue).getByText("a.png").closest("tr") as HTMLElement;
    expect(within(rowA2).getByText(en("ocr.cancelled"))).toBeInTheDocument();
    expect(within(await screen.findByTestId("pending-list")).queryByText("a.png")).not.toBeInTheDocument();
    // "Clear finished" removes the ended rows (cancelled, failed, uploaded)
    await userEvent.click(screen.getByRole("button", { name: en("ocr.clearFinished") }));
    await waitFor(() => expect(screen.queryByTestId("upload-queue")).not.toBeInTheDocument());
  });

  it("tenant switch resets the page (final review 4)", async () => {
    signedIn(
      {
        "GET /api/v1/files/pending": () => json(200, []),
        "GET /api/v1/ocr/jobs": (r) => {
          const stage = new URL(r.url).searchParams.get("stage");
          const org = r.headers.get("X-Tenant-Id") === "5";
          return page(org && stage === "OCR_PROCESSING" ? [job("j9", "OCR_PROCESSING")] : []);
        },
      },
      { tenants: [PERSONAL, ORG] },
    );
    localStorage.setItem("saiflow.pc.tenant.7", "5");
    useTenantChoice.getState().reset();
    renderAt("/upload");
    const status = await screen.findByTestId("recognition-status");
    await within(status).findByText("j9.png");
    await userEvent.click(screen.getByRole("button", { name: en("tenant.switch") }));
    await userEvent.click(await screen.findByRole("menuitem", { name: en("tenant.personal") }));
    await waitFor(() => expect(within(screen.getByTestId("recognition-status")).queryByText("j9.png")).not.toBeInTheDocument());
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByRole("link", { name: en("ocr.goVerify") })).not.toBeInTheDocument();
  });

  it("start recognition creates jobs and leaves pending (127-03)", async () => {
    const pending = { current: [file("p1", "x.png"), file("p2", "y.png"), file("p3", "z.png")] as unknown[] };
    const created: string[] = [];
    const api = signedIn({
      "GET /api/v1/files/pending": () => json(200, pending.current),
      "POST /api/v1/ocr/jobs": async (r) => {
        const body = (await r.json()) as { file_id: string };
        created.push(body.file_id);
        pending.current = pending.current.filter((f) => (f as { id: string }).id !== body.file_id);
        return json(201, job(`j-${body.file_id}`, "OCR_PROCESSING"));
      },
      "GET /api/v1/ocr/jobs": jobsBy({}),
    });
    renderAt("/upload");
    const list = await screen.findByTestId("pending-list");
    await within(list).findByText("x.png");
    await userEvent.click(within(list).getAllByRole("checkbox")[0]!); // select all
    await userEvent.click(screen.getByRole("button", { name: en("ocr.startRecognition", { n: 3 }) }));
    await waitFor(() => expect(created).toEqual(["p1", "p2", "p3"]));
    const bodies = (await api.bodies("POST /api/v1/ocr/jobs")) as { idempotency_key: string }[];
    expect(bodies.map((b) => b.idempotency_key)).toEqual(["pc-p1", "pc-p2", "pc-p3"]);
    await waitFor(() => expect(within(list).queryByText("x.png")).not.toBeInTheDocument());
  });

  it("quota exceeded keeps the file (127-04)", async () => {
    signedIn({
      "GET /api/v1/files/pending": () => json(200, [file("p1", "big.pdf", 3)]),
      "POST /api/v1/ocr/jobs": () => json(402, { code: "quota_exceeded", details: { available: 2 } }),
      "GET /api/v1/ocr/jobs": jobsBy({}),
    });
    renderAt("/upload");
    const list = await screen.findByTestId("pending-list");
    await within(list).findByText("big.pdf");
    await userEvent.click(within(list).getAllByRole("checkbox")[1]!);
    await userEvent.click(screen.getByRole("button", { name: en("ocr.startRecognition", { n: 1 }) }));
    expect(await screen.findByText(en("ocr.quotaLeft", { n: 2 }))).toBeInTheDocument();
    expect(within(list).getByText("big.pdf")).toBeInTheDocument();
  });

  it("no upload permission", async () => {
    localStorage.setItem("saiflow.pc.tenant.7", "5");
    useTenantChoice.getState().reset();
    signedIn({}, { tenants: [PERSONAL, { ...ORG, permissions: ["data_browse"] }] });
    renderAt("/upload");
    expect(await screen.findByText(en("ocr.noUploadPermission"))).toBeInTheDocument();
  });
});

describe("recognition status (FR-SYS-128)", () => {
  it("finished job offers go to verify (128-01)", async () => {
    let done = false;
    signedIn({
      "GET /api/v1/files/pending": () => json(200, []),
      "GET /api/v1/ocr/jobs": (r) => {
        const stage = new URL(r.url).searchParams.get("stage");
        return page(stage === "OCR_PROCESSING" && !done ? [job("j1", "OCR_PROCESSING")] : []);
      },
      "GET /api/v1/ocr/jobs/j1": () => json(200, job("j1", "VERIFYING")),
    });
    renderAt("/upload");
    const status = await screen.findByTestId("recognition-status");
    await within(status).findByText("j1.png");
    done = true;
    expect(await screen.findByRole("link", { name: en("ocr.goVerify") }, { timeout: 6000 })).toHaveAttribute(
      "href",
      "/verify/j1",
    );
  }, 10000);

  it("failed job shows reason and rerun (128-02)", async () => {
    const api = signedIn({
      "GET /api/v1/files/pending": () => json(200, []),
      "GET /api/v1/ocr/jobs": jobsBy({ OCR_FAILED: [job("j2", "OCR_FAILED")] }),
      "POST /api/v1/ocr/jobs/j2/rerun": () => json(201, job("j3", "OCR_PROCESSING")),
    });
    renderAt("/upload");
    const status = await screen.findByTestId("recognition-status");
    const row = (await within(status).findByText("j2.png")).closest("tr") as HTMLElement;
    expect(within(row).getByText(en("ocrerr.VENDOR_TIMEOUT"))).toBeInTheDocument();
    await userEvent.click(within(row).getByRole("button", { name: en("ocr.rerun") }));
    await waitFor(() => expect(api.count("POST /api/v1/ocr/jobs/j2/rerun")).toBe(1));
  });
});


describe("upload page fixes (minor-fixes-ui)", () => {
  it("status shows step and pages", async () => {
    signedIn({
      "GET /api/v1/files/pending": () => json(200, []),
      "GET /api/v1/ocr/jobs": jobsBy({ OCR_PROCESSING: [job("j1", "OCR_PROCESSING", { status: "PROCESSING", page_count: 3 })] }),
    });
    renderAt("/upload");
    const row = (await within(await screen.findByTestId("recognition-status")).findByText("j1.png")).closest("tr") as HTMLElement;
    expect(within(row).getByText(en("ocr.step.PROCESSING"))).toBeInTheDocument();
    expect(within(row).getByText(en("ocr.pages", { n: 3 }))).toBeInTheDocument();
  });

  it("fast finish is announced", async () => {
    signedIn({
      "GET /api/v1/files/pending": () => json(200, [file("p1", "x.png")]),
      "POST /api/v1/ocr/jobs": () => json(201, job("j7", "OCR_PROCESSING")),
      "GET /api/v1/ocr/jobs": jobsBy({}),
      "GET /api/v1/ocr/jobs/j7": () => json(200, job("j7", "VERIFYING")),
    });
    renderAt("/upload");
    const list = await screen.findByTestId("pending-list");
    await within(list).findByText("x.png");
    await userEvent.click(within(list).getAllByRole("checkbox")[1]!);
    await userEvent.click(screen.getByRole("button", { name: en("ocr.startRecognition", { n: 1 }) }));
    expect(await screen.findByRole("link", { name: en("ocr.goVerify") }, { timeout: 6000 })).toHaveAttribute("href", "/verify/j7");
  }, 10000);

  it("job beyond 20 is not falsely finished", async () => {
    const many = Array.from({ length: 20 }, (_, i) => job(`n${i}`, "OCR_PROCESSING", { created_at: `2026-11-07T02:${String(10 + i).padStart(2, "0")}:00Z` }));
    let round = 0;
    signedIn({
      "GET /api/v1/files/pending": () => json(200, []),
      "GET /api/v1/ocr/jobs": (r) => {
        const stage = new URL(r.url).searchParams.get("stage");
        if (stage !== "OCR_PROCESSING") return page([]);
        round += 1;
        return page(round === 1 ? [job("old", "OCR_PROCESSING", { created_at: "2026-11-07T01:00:00Z" })] : many);
      },
      "GET /api/v1/ocr/jobs/old": () => json(200, job("old", "OCR_PROCESSING")),
    });
    renderAt("/upload");
    await within(await screen.findByTestId("recognition-status")).findByText("old.png");
    await within(screen.getByTestId("recognition-status")).findByText("n0.png", {}, { timeout: 6000 });
    await new Promise((r) => setTimeout(r, 300));
    expect(screen.queryByRole("link", { name: en("ocr.goVerify") })).not.toBeInTheDocument();
  }, 10000);

  it("drop while busy appends; over 10 rejected", async () => {
    let release: () => void = () => {};
    let n = 0;
    signedIn({
      "POST /api/v1/uploads": async (r) => {
        const body = (await r.json()) as { file_name: string };
        n += 1;
        return json(201, { ...file(`u${n}`, body.file_name), status: "UPLOADING" });
      },
      "PUT /api/v1/uploads/u1/content": () => new Promise<Response>((r) => (release = () => r(json(204, null)))),
      "GET /api/v1/files/pending": () => json(200, []),
      "GET /api/v1/ocr/jobs": jobsBy({}),
    });
    renderAt("/upload");
    await screen.findByTestId("page-upload");
    await drop([new File(["x"], "first.png", { type: "image/png" })]);
    const queue = await screen.findByTestId("upload-queue");
    await within(queue).findByText("first.png");
    await drop(Array.from({ length: 11 }, (_, i) => new File(["x"], `more-${i}.png`, { type: "image/png" })));
    expect(await within(queue).findByText("more-0.png")).toBeInTheDocument();
    expect(within(queue).getByText("more-9.png")).toBeInTheDocument();
    expect(within(queue).queryByText("more-10.png")).not.toBeInTheDocument();
    expect(await screen.findByText(en("ocr.tooManyFiles", { n: 10 }))).toBeInTheDocument();
    release();
  });

  it("delete failure shown", async () => {
    signedIn({
      "GET /api/v1/files/pending": () => json(200, [file("p1", "x.png")]),
      "DELETE /api/v1/files/p1": () => json(500, { code: "internal" }),
      "GET /api/v1/ocr/jobs": jobsBy({}),
    });
    renderAt("/upload");
    const list = await screen.findByTestId("pending-list");
    await within(list).findByText("x.png");
    await userEvent.click(within(list).getAllByRole("checkbox")[1]!);
    await userEvent.click(screen.getByRole("button", { name: en("ocr.deleteSelected") }));
    await userEvent.click(await screen.findByRole("button", { name: en("common.confirm") }));
    expect(await screen.findByText(en("err.unknown"))).toBeInTheDocument();
  });
});
