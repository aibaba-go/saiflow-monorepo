import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useLanguage } from "../stores/language";
import { json } from "../test/mockApi";
import { renderAt, signedIn, userEvent, zh } from "../test/admin";

const T0 = "2026-11-01T03:00:00Z";

function org(tenant_id: number, name: string, extra: Record<string, unknown> = {}) {
  return {
    tenant_id, name, contact_phone: "0812345678", address: "Bangkok", status: "active",
    verification_status: "none", member_count: 3, created_at: T0, ...extra,
  };
}

beforeEach(() => {
  localStorage.clear();
  useLanguage.getState().setLang("zh");
});

/** Choose an option of the antd Select labelled `label`. */
async function pick(label: string, option: string) {
  await userEvent.click(screen.getByLabelText(label));
  const item = await waitFor(() => {
    const found = document.querySelector<HTMLElement>(`.ant-select-item-option[title="${option}"]`);
    if (!found) throw new Error(`no option ${option}`);
    return found;
  });
  await userEvent.click(item);
}

async function confirm(button: string) {
  await userEvent.click(screen.getByRole("button", { name: button }));
  await userEvent.click(await screen.findByRole("button", { name: zh("common.confirm") }));
}

describe("organizations (FR-SYS-064)", () => {
  it("finds by name and opens the detail (064-01)", async () => {
    signedIn({
      "GET /api/v1/admin/organizations": () =>
        json(200, [org(1, "Siam Tools", { verification_status: "verified" }), org(2, "Bangkok Trading")]),
      "GET /api/v1/admin/organizations/1": () => json(200, org(1, "Siam Tools", { verification_status: "verified" })),
    });
    renderAt("/organizations");
    expect(await screen.findByText("Bangkok Trading")).toBeInTheDocument();
    await userEvent.type(screen.getByPlaceholderText(zh("org.search")), "siam");
    await waitFor(() => expect(screen.queryByText("Bangkok Trading")).not.toBeInTheDocument());
    await userEvent.click(screen.getByRole("link", { name: "Siam Tools" }));
    expect(await screen.findByRole("heading", { name: "Siam Tools" })).toBeInTheDocument();
    const facts = screen.getByTestId("org-facts");
    expect(within(facts).getByText(zh("org.status.active"))).toBeInTheDocument();
    expect(within(facts).getByText(zh("verify.verified"))).toBeInTheDocument();
    expect(within(facts).getByText("3")).toBeInTheDocument();
  });

  it("disables then enables after confirming (064-02)", async () => {
    const o = org(1, "Siam Tools");
    const api = signedIn({
      "GET /api/v1/admin/organizations/1": () => json(200, o),
      "POST /api/v1/admin/organizations/1/disable": () => {
        o.status = "disabled";
        return json(200, { status: "disabled" });
      },
      "POST /api/v1/admin/organizations/1/enable": () => {
        o.status = "active";
        return json(200, { status: "active" });
      },
    });
    renderAt("/organizations/1");
    const facts = await screen.findByTestId("org-facts");
    await confirm(zh("org.disable"));
    expect(await within(facts).findByText(zh("org.status.disabled"))).toBeInTheDocument();
    await confirm(zh("org.enable"));
    expect(await within(facts).findByText(zh("org.status.active"))).toBeInTheDocument();
    expect(api.count("POST /api/v1/admin/organizations/1/disable")).toBe(1);
    expect(api.count("POST /api/v1/admin/organizations/1/enable")).toBe(1);
  });

  it("an empty name shows an error under it and saves nothing (064-03)", async () => {
    const api = signedIn({ "GET /api/v1/admin/organizations/1": () => json(200, org(1, "Siam Tools")) });
    renderAt("/organizations/1");
    const name = await screen.findByLabelText(zh("col.name"));
    await userEvent.clear(name);
    await userEvent.click(screen.getByRole("button", { name: zh("common.save") }));
    expect(await screen.findByText(zh("field.required"))).toBeInTheDocument();
    expect(api.count("PATCH /api/v1/admin/organizations/1")).toBe(0);
  });

  it("a backend field error shows under its input", async () => {
    signedIn({
      "GET /api/v1/admin/organizations/1": () => json(200, org(1, "Siam Tools")),
      "PATCH /api/v1/admin/organizations/1": () => json(400, { code: "validation_error", fields: ["contact_phone"] }),
    });
    renderAt("/organizations/1");
    await userEvent.click(await screen.findByRole("button", { name: zh("common.save") }));
    expect(await screen.findByText(zh("field.contact_phone"))).toBeInTheDocument();
  });

  it("sets and unsets verification after confirming", async () => {
    const o = org(1, "Siam Tools");
    const api = signedIn({
      "GET /api/v1/admin/organizations/1": () => json(200, o),
      "PUT /api/v1/admin/organizations/1/verification": async (r) => {
        const { verified } = (await r.json()) as { verified: boolean };
        o.verification_status = verified ? "verified" : "none";
        return json(200, { verified });
      },
    });
    renderAt("/organizations/1");
    const facts = await screen.findByTestId("org-facts");
    await confirm(zh("org.setVerified"));
    expect(await within(facts).findByText(zh("verify.verified"))).toBeInTheDocument();
    await confirm(zh("org.unsetVerified"));
    expect(await within(facts).findByText(zh("verify.none"))).toBeInTheDocument();
    expect(await api.bodies("PUT /api/v1/admin/organizations/1/verification")).toEqual([
      { verified: true },
      { verified: false },
    ]);
  });
});

describe("tenant subscriptions and reservations (FR-SYS-066)", () => {
  it("sets Starter monthly with empty dates (066-01)", async () => {
    const subs: unknown[] = [];
    const api = signedIn({
      "GET /api/v1/admin/tenants/5/subscriptions": () => json(200, subs),
      "GET /api/v1/admin/tenants/5/reservations": () => json(200, []),
      "PUT /api/v1/admin/tenants/5/subscription": () => {
        const sub = {
          id: 1, plan_code: "starter", period: "month", starts_at: T0,
          ends_at: "2026-12-01T03:00:00Z", source: "admin", application_id: null,
        };
        subs.push(sub);
        return json(200, sub);
      },
    });
    renderAt("/tenants/5/billing?kind=organization");
    await screen.findByRole("heading", { name: zh("billing.title", { id: 5 }) });
    await pick(zh("billing.plan"), "Starter");
    await userEvent.click(screen.getByRole("button", { name: zh("billing.save") }));
    const history = await screen.findByTestId("subscription-history");
    expect(await within(history).findByText("Starter")).toBeInTheDocument();
    expect(within(history).getByText(zh("source.admin"))).toBeInTheDocument();
    expect(await api.bodies("PUT /api/v1/admin/tenants/5/subscription")).toEqual([
      { plan_code: "starter", period: "month" },
    ]);
  });

  it("a plan the tenant cannot have shows the error under the plan (066-02)", async () => {
    signedIn({
      "GET /api/v1/admin/tenants/7/subscriptions": () => json(200, []),
      "GET /api/v1/admin/tenants/7/reservations": () => json(200, []),
      "PUT /api/v1/admin/tenants/7/subscription": () =>
        json(400, { code: "validation_error", fields: ["plan_code"] }),
    });
    renderAt("/tenants/7/billing?kind=personal");
    await screen.findByText(zh("billing.kind.personal"));
    await pick(zh("billing.plan"), "Starter");
    await userEvent.click(screen.getByRole("button", { name: zh("billing.save") }));
    expect(await screen.findByText(zh("field.plan_code"))).toBeInTheDocument();
  });

  it("lists reservations with the split and the release time (066-03)", async () => {
    const res = (id: number, released: string | null) => ({
      id, reference: `scan-${id}`, pages: 4, from_free: 1, from_monthly: 3, month: "2026-11-01",
      reserved_at: T0, released_at: released,
    });
    signedIn({
      "GET /api/v1/admin/tenants/5/subscriptions": () => json(200, []),
      "GET /api/v1/admin/tenants/5/reservations": () =>
        json(200, [res(1, null), res(2, "2026-11-02T05:00:00Z"), res(3, null)]),
    });
    renderAt("/tenants/5/billing?kind=organization");
    const table = await screen.findByTestId("reservations");
    expect(await within(table).findByText("scan-1")).toBeInTheDocument();
    expect(within(table).getByText("scan-3")).toBeInTheDocument();
    const second = within(table).getByText("scan-2").closest("tr") as HTMLElement;
    expect(within(second).getByText("2026-11-02 12:00")).toBeInTheDocument();
    expect(within(second).getByText("2026-11")).toBeInTheDocument();
    expect(within(table).getAllByText("4")).toHaveLength(3);
  });
});
