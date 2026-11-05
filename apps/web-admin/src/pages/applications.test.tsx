import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useLanguage } from "../stores/language";
import { json } from "../test/mockApi";
import { renderAt, signedIn, userEvent, zh } from "../test/admin";

const T0 = "2026-11-01T03:00:00Z";

type Status = "pending" | "approved" | "rejected";

function orgApp(id: number, name: string, status: Status = "pending") {
  return {
    id, name, contact_phone: "0812345678", address: "Bangkok", status, reject_reason: null as string | null,
    tenant_id: null, created_at: T0, decided_at: null as string | null, applicant_user_id: 10 + id,
  };
}

function verificationApp(id: number, legal: string) {
  return {
    id, tenant_id: 100 + id, legal_name: legal, tax_id: "0105555000000", registered_address: "Bangkok",
    status: "pending" as Status, reject_reason: null as string | null, created_at: T0,
  };
}

function planApp(id: number) {
  return {
    id, tenant_id: 200 + id, applicant_user_id: 7, plan_code: "intermediate", period: "year",
    note: "transfer done", status: "pending" as Status, reject_reason: null as string | null,
    subscription_id: null, created_at: T0, decided_at: null,
  };
}

/** A list endpoint that filters by ?status= like the backend. */
function lister<A extends { status: Status }>(rows: A[]) {
  return (r: Request) => {
    const status = new URL(r.url).searchParams.get("status");
    return json(200, rows.filter((a) => !status || a.status === status));
  };
}

const idOf = (r: Request) => Number(new URL(r.url).pathname.split("/").at(-2));

beforeEach(() => {
  localStorage.clear();
  useLanguage.getState().setLang("zh");
});

async function openTab(name: string) {
  await userEvent.click(screen.getByRole("tab", { name }));
}

async function rejectWith(row: HTMLElement, reason: string) {
  await userEvent.click(within(row).getByRole("button", { name: zh("app.reject") }));
  const dialog = await screen.findByRole("dialog");
  if (reason) await userEvent.type(within(dialog).getByLabelText(zh("reject.reason")), reason);
  await userEvent.click(within(dialog).getByRole("button", { name: zh("reject.submit") }));
}

const rowOf = async (text: string) => (await screen.findByText(text)).closest("tr") as HTMLElement;

describe("home (AC-FR-SYS-060-04)", () => {
  it("shows pending counts 2/1/0 and the 2 opens pending organization applications", async () => {
    const api = signedIn({
      "GET /api/v1/admin/organization-applications": lister([orgApp(1, "A"), orgApp(2, "B"), orgApp(3, "C", "approved")]),
      "GET /api/v1/admin/verification-applications": lister([verificationApp(1, "X")]),
      "GET /api/v1/admin/plan-applications": lister([]),
    });
    renderAt("/");
    const two = await screen.findByRole("link", { name: "2" });
    expect(screen.getByRole("link", { name: "1" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "0" })).toBeInTheDocument();
    await userEvent.click(two);
    expect(await screen.findByRole("heading", { name: zh("nav.organizationApplications") })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: zh("app.status.pending"), selected: true })).toBeInTheDocument();
    expect(await screen.findByText("A")).toBeInTheDocument();
    expect(screen.queryByText("C")).not.toBeInTheDocument();
    expect(api.calls.every((c) => !c.url.includes("applications") || c.url.includes("status=pending"))).toBe(true);
  });
});

describe("organization applications (FR-SYS-063)", () => {
  it("approve moves it out of pending into approved (063-01)", async () => {
    const rows = [orgApp(1, "Siam Tools")];
    const api = signedIn({
      "GET /api/v1/admin/organization-applications": lister(rows),
      "POST /api/v1/admin/organization-applications/1/approve": () => {
        rows[0]!.status = "approved";
        return json(202, { status: "accepted" });
      },
    });
    renderAt("/organization-applications");
    const row = await rowOf("Siam Tools");
    await userEvent.click(within(row).getByRole("button", { name: zh("app.approve") }));
    await userEvent.click(await screen.findByRole("button", { name: zh("common.confirm") }));
    await waitFor(() => expect(screen.queryByText("Siam Tools")).not.toBeInTheDocument());
    expect(api.count("POST /api/v1/admin/organization-applications/1/approve")).toBe(1);
    await openTab(zh("app.status.approved"));
    expect(await screen.findByText("Siam Tools")).toBeInTheDocument();
  });

  it("reject needs a reason, then shows it (063-02)", async () => {
    const rows = [orgApp(1, "Siam Tools")];
    const api = signedIn({
      "GET /api/v1/admin/organization-applications": lister(rows),
      "POST /api/v1/admin/organization-applications/1/reject": async (r) => {
        const { reason } = (await r.json()) as { reason: string };
        Object.assign(rows[0]!, { status: "rejected", reject_reason: reason, decided_at: T0 });
        return json(200, { status: "rejected" });
      },
    });
    renderAt("/organization-applications");
    await rejectWith(await rowOf("Siam Tools"), "");
    expect(await screen.findByText(zh("field.required"))).toBeInTheDocument();
    expect(api.count("POST /api/v1/admin/organization-applications/1/reject")).toBe(0);
    const dialog = screen.getByRole("dialog");
    await userEvent.type(within(dialog).getByLabelText(zh("reject.reason")), "联系电话无法接通");
    await userEvent.click(within(dialog).getByRole("button", { name: zh("reject.submit") }));
    await waitFor(() => expect(screen.queryByText("Siam Tools")).not.toBeInTheDocument());
    expect(await api.bodies("POST /api/v1/admin/organization-applications/1/reject")).toEqual([
      { reason: "联系电话无法接通" },
    ]);
    await openTab(zh("app.status.rejected"));
    expect(await screen.findByText("联系电话无法接通")).toBeInTheDocument();
  });

  it("an application someone else decided shows the message and refreshes (073-02)", async () => {
    const rows = [orgApp(1, "Siam Tools")];
    const api = signedIn({
      "GET /api/v1/admin/organization-applications": lister(rows),
      "POST /api/v1/admin/organization-applications/1/reject": () => {
        rows[0]!.status = "approved";
        return json(409, { code: "already_decided" });
      },
    });
    renderAt("/organization-applications");
    await rejectWith(await rowOf("Siam Tools"), "duplicate");
    expect(await screen.findByText(zh("err.already_decided"))).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByText("Siam Tools")).not.toBeInTheDocument());
    expect(api.count("GET /api/v1/admin/organization-applications")).toBeGreaterThanOrEqual(2);
  });

  it("a second click while approving sends one request (073-01)", async () => {
    let release!: () => void;
    const api = signedIn({
      "GET /api/v1/admin/organization-applications": lister([orgApp(1, "Siam Tools")]),
      "POST /api/v1/admin/organization-applications/1/approve": () =>
        new Promise<Response>((r) => (release = () => r(json(202, { status: "accepted" })))),
    });
    renderAt("/organization-applications");
    const row = await rowOf("Siam Tools");
    const approve = within(row).getByRole("button", { name: zh("app.approve") });
    await userEvent.click(approve);
    await userEvent.click(await screen.findByRole("button", { name: zh("common.confirm") }));
    await waitFor(() => expect(approve).toHaveClass("ant-btn-loading"));
    await userEvent.click(approve);
    const again = screen.queryAllByRole("button", { name: zh("common.confirm") });
    for (const b of again) await userEvent.click(b);
    release();
    await waitFor(() => expect(api.count("POST /api/v1/admin/organization-applications/1/approve")).toBe(1));
  });
});

describe("verification applications (AC-FR-SYS-065-01)", () => {
  it("approves the first and rejects the second with a reason", async () => {
    const rows = [verificationApp(1, "Siam Tools Co., Ltd."), verificationApp(2, "Bad Name Ltd.")];
    const api = signedIn({
      "GET /api/v1/admin/verification-applications": lister(rows),
      "POST /api/v1/admin/verification-applications/1/approve": (r) => {
        rows[idOf(r) - 1]!.status = "approved";
        return json(200, { status: "approved" });
      },
      "POST /api/v1/admin/verification-applications/2/reject": async (r) => {
        Object.assign(rows[1]!, { status: "rejected", reject_reason: ((await r.json()) as { reason: string }).reason });
        return json(200, { status: "rejected" });
      },
    });
    renderAt("/verification-applications");
    const first = await rowOf("Siam Tools Co., Ltd.");
    await userEvent.click(within(first).getByRole("button", { name: zh("app.approve") }));
    await userEvent.click(await screen.findByRole("button", { name: zh("common.confirm") }));
    await waitFor(() => expect(screen.queryByText("Siam Tools Co., Ltd.")).not.toBeInTheDocument());
    await rejectWith(await rowOf("Bad Name Ltd."), "税号不符");
    await waitFor(() => expect(screen.queryByText("Bad Name Ltd.")).not.toBeInTheDocument());
    expect(api.count("POST /api/v1/admin/verification-applications/1/approve")).toBe(1);
    await openTab(zh("app.status.rejected"));
    expect(await screen.findByText("税号不符")).toBeInTheDocument();
  });
});

describe("plan applications (FR-SYS-067)", () => {
  it("approve with empty dates sends no dates (067-01)", async () => {
    const rows = [planApp(1)];
    const api = signedIn({
      "GET /api/v1/admin/plan-applications": lister(rows),
      "POST /api/v1/admin/plan-applications/1/approve": () => {
        rows[0]!.status = "approved";
        return json(200, { id: 9 });
      },
    });
    renderAt("/plan-applications");
    const row = await rowOf("transfer done");
    expect(within(row).getByText("Intermediate")).toBeInTheDocument();
    await userEvent.click(within(row).getByRole("button", { name: zh("app.approve") }));
    const dialog = await screen.findByRole("dialog");
    await userEvent.click(within(dialog).getByRole("button", { name: zh("planApprove.submit") }));
    await waitFor(() => expect(screen.queryByText("transfer done")).not.toBeInTheDocument());
    expect(await api.bodies("POST /api/v1/admin/plan-applications/1/approve")).toEqual([{}]);
  });

  it("reject with a reason (067-02)", async () => {
    const rows = [planApp(1)];
    const api = signedIn({
      "GET /api/v1/admin/plan-applications": lister(rows),
      "POST /api/v1/admin/plan-applications/1/reject": async (r) => {
        Object.assign(rows[0]!, { status: "rejected", reject_reason: ((await r.json()) as { reason: string }).reason });
        return json(200, rows[0]);
      },
    });
    renderAt("/plan-applications");
    await rejectWith(await rowOf("transfer done"), "未收到款项");
    await waitFor(() => expect(screen.queryByText("transfer done")).not.toBeInTheDocument());
    expect(await api.bodies("POST /api/v1/admin/plan-applications/1/reject")).toEqual([{ reason: "未收到款项" }]);
    await openTab(zh("app.status.rejected"));
    expect(await screen.findByText("未收到款项")).toBeInTheDocument();
  });
});
