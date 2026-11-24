import { screen, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";
import { en, renderAt, signedIn } from "../test/app";
import { ORG, PERSONAL } from "../test/fixtures";
import { json } from "../test/mockApi";
import { useLanguage } from "../stores/language";
import { useTenantChoice } from "../tenants/useCurrentTenant";

const USAGE = { plan: { code: "starter" }, active: true, month: { quota: 5000, used: 0, remaining: 5000 }, free: { remaining: 0 } };
beforeEach(() => { localStorage.clear(); sessionStorage.clear(); useLanguage.getState().setLang("en"); useTenantChoice.getState().reset(); localStorage.setItem("saiflow.pc.tenant.7", "5"); });
describe("data source page (FR-DATA-001/002)", () => {
  it("shows the management menu and tenant source catalog to a permitted manager", async () => {
    const api = signedIn({ "GET /api/v1/billing/usage": () => json(200, USAGE), "GET /api/v1/data-sources": () => json(200, { items: [{ id: "template:1", name: "Invoice", kind: "template", enabled: true, password_configured: false }] }) }, { tenants: [PERSONAL, { ...ORG, permissions: ["report_manage", "data_browse"] }] });
    renderAt("/data-sources");
    expect(await screen.findByRole("button", { name: "Add PostgreSQL source" })).toBeInTheDocument();
    const system = (await screen.findByText("SaiFlow PostgreSQL")).closest("tr")!;
    expect(within(system).getByText("Display only · Not editable")).toBeInTheDocument();
    expect(within(system).getByText("System managed")).toBeInTheDocument();
    expect(within(system).getByText("—")).toBeInTheDocument();
    expect(within(system).queryByRole("button")).toBeNull();
    expect(screen.queryByText("No data")).toBeNull();
    expect(screen.queryByLabelText("SQL")).toBeNull();
    expect(screen.queryByText("Invoice")).toBeNull();
    expect(within(screen.getByRole("menu")).getByRole("link", { name: "Data sources" })).toHaveAttribute("href", "/data-sources");
    expect(api.calls.find(r => new URL(r.url).pathname === "/api/v1/data-sources")!.headers.get("X-Tenant-Id")).toBe("5");
    expect(within(system).getByText("Built-in PostgreSQL")).toBeInTheDocument();
    expect(api.calls.some(r => new URL(r.url).pathname.includes("system-pg"))).toBe(false);
  });
  it("does not request source metadata for a view-only member", async () => {
    const api = signedIn({ "GET /api/v1/billing/usage": () => json(200, USAGE) }, { tenants: [PERSONAL, { ...ORG, permissions: ["report_view"] }] });
    renderAt("/data-sources");
    expect(await screen.findByText(en("rpt.noAccess"))).toBeInTheDocument();
    expect(within(screen.getByRole("menu")).queryByRole("link", { name: "Data sources" })).toBeNull();
    expect(api.count("GET /api/v1/data-sources")).toBe(0);
  });
});
