import { screen, within } from "@testing-library/react";
import { beforeEach, expect, it } from "vitest";
import { renderAt, signedIn, userEvent } from "../test/admin";
import { json } from "../test/mockApi";
import { useLanguage } from "../stores/language";

beforeEach(() => { localStorage.clear(); useLanguage.getState().setLang("en"); });
it("admin accesses read-only built-in PG without a tenant (FR-DATA-002)", async () => {
  const api = signedIn({ "GET /api/v1/admin/organizations": () => json(200, []), "GET /api/v1/admin/data-sources": () => json(200, { items: [{ id: "system-pg", name: "System PG", kind: "system_pg", enabled: true, password_configured: true }] }) });
  renderAt("/data-sources");
  const row = (await screen.findByText("System PG")).closest("tr")!;
  expect(within(row).getByRole("button", { name: "Query" })).toBeInTheDocument();
  expect(within(row).queryByRole("button", { name: "Edit" })).toBeNull();
  expect(screen.queryByRole("button", { name: "Add PostgreSQL source" })).toBeNull();
  expect(screen.getByText("Select an organization to create and manage its PostgreSQL connections. The built-in system source cannot be edited or deleted.")).toBeInTheDocument();
  expect(new URL(api.calls.find(r => new URL(r.url).pathname === "/api/v1/admin/data-sources")!.url).searchParams.has("tenant_id")).toBe(false);
});

it("shows organization CRUD controls while leaving built-in PG immutable (FR-DATA-001)", async () => {
  const api = signedIn({
    "GET /api/v1/admin/organizations": () => json(200, [{ tenant_id: 7, name: "Factory" }]),
    "GET /api/v1/admin/data-sources": () => json(200, { items: [
      { id: "system-pg", name: "System PG", kind: "system_pg", enabled: true, password_configured: true },
      { id: "postgres:1", name: "ERP", kind: "postgresql", enabled: true, password_configured: true, host: "erp.test", port: 5432, database: "erp", username: "reader" },
      { id: "template:1", name: "Invoice template", kind: "template", enabled: true, password_configured: false },
    ] }),
  });
  renderAt("/data-sources?tenant=7");
  await userEvent.click(await screen.findByRole("button", { name: "Add PostgreSQL source" }));
  expect(await screen.findByRole("dialog")).toBeInTheDocument();
  await userEvent.click(screen.getByRole("button", { name: "Cancel" }));
  const external = (await screen.findByText("ERP")).closest("tr")!;
  expect(screen.queryByText("Invoice template")).toBeNull();
  expect(within(external).getByRole("button", { name: "Edit" })).toBeInTheDocument();
  expect(within(external).getByRole("button", { name: "Delete" })).toBeInTheDocument();
  const builtin = screen.getByText("System PG").closest("tr")!;
  expect(within(builtin).queryByRole("button", { name: "Edit" })).toBeNull();
  expect(within(builtin).queryByRole("button", { name: "Delete" })).toBeNull();
  expect(new URL(api.calls.find(r => new URL(r.url).pathname === "/api/v1/admin/data-sources")!.url).searchParams.get("tenant_id")).toBe("7");
});
