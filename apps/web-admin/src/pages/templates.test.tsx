import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { useLanguage } from "../stores/language";
import { json } from "../test/mockApi";
import { renderAt, signedIn, userEvent, zh } from "../test/admin";

// antd + the template editor render slowly in jsdom (and much slower under `pnpm -r test`)
vi.setConfig({ testTimeout: 60_000 });

beforeEach(() => {
  localStorage.clear();
  useLanguage.getState().setLang("zh");
});

const validContent = () => ({
  code: "invoice",
  name: "Invoice",
  description: "",
  groups: [
    {
      key: "header",
      name: "Header",
      description: "",
      items: [{ kind: "field", key: "number", name: "Number", description: "", type: "string", required: false, primary: false, role: null }],
    },
  ],
});

function detail(over: Record<string, unknown> = {}) {
  return {
    id: 1,
    scope: "system",
    tenant_id: null,
    code: "invoice",
    name: "Invoice",
    status: "ENABLED",
    has_draft: true,
    current_version: null,
    revision: 1,
    can_manage: true,
    deletable: true,
    protected_reasons: [],
    updated_at: "2026-11-01T03:00:00Z",
    draft: validContent(),
    draft_errors: [],
    pending_confirmations: [],
    current: null,
    versions: [],
    grant: { mode: null, plans: [], users: [], organizations: [] },
    ...over,
  };
}

const nameInput = () =>
  within(screen.getByRole("region", { name: "模板" })).getAllByRole("textbox", { name: "名称" })[0]!;
const codeInput = () => within(screen.getByRole("region", { name: "模板" })).getByRole("textbox", { name: "编码" });

async function confirm(label: string) {
  await userEvent.click(await screen.findByRole("button", { name: label }));
  await userEvent.click(await screen.findByRole("button", { name: zh("common.confirm") }));
}

describe("admin templates (FR-SYS-142)", () => {
  it("has a menu item and lists templates with the grant summary of system ones", async () => {
    signedIn({
      "GET /api/v1/admin/templates": () =>
        json(200, {
          items: [
            { ...detail(), has_draft: false, current_version: { id: 3, version: 2, activated_at: "2026-11-01T03:00:00Z" } },
            { ...detail({ id: 2, scope: "personal", tenant_id: 7, code: "receipt", name: "Receipt" }) },
            { ...detail({ id: 3, scope: "organization", tenant_id: 9, code: "po", name: "PO", owner_name: "Siam Widgets" }) },
          ],
        }),
      "GET /api/v1/admin/templates/1": () =>
        json(200, detail({ grant: { mode: "PLANS", plans: ["starter", "intermediate"], users: [], organizations: [] } })),
    });
    renderAt("/templates");
    const nav = await screen.findByRole("navigation", { name: zh("layout.mainNav") });
    expect(within(nav).getByRole("link", { name: zh("nav.templates") })).toHaveAttribute("href", "/templates");

    const system = (await screen.findByRole("link", { name: "Invoice" })).closest("tr") as HTMLElement;
    expect(await within(system).findByText(zh("tpl.grant.plansSummary", { plans: "Starter, Intermediate" }))).toBeInTheDocument();
    expect(within(system).getByText("v2")).toBeInTheDocument();
    const personal = screen.getByRole("link", { name: "Receipt" }).closest("tr") as HTMLElement;
    expect(within(personal).getByText(zh("tpl.ownerPersonal", { id: 7 }))).toBeInTheDocument();
    expect(within(personal).getByText(zh("tpl.hasDraft"))).toBeInTheDocument();
    const org = screen.getByRole("link", { name: "PO" }).closest("tr") as HTMLElement;
    expect(within(org).getByText(`${zh("kind.organization")} · Siam Widgets`)).toBeInTheDocument();
  });

  it("creates a system template as a draft, then saves the draft with its revision", async () => {
    const api = signedIn({
      "POST /api/v1/admin/templates": () =>
        json(201, detail({ id: 5, draft: { code: "po", name: "PO", description: "", groups: [] }, code: "po", name: "PO" })),
      "GET /api/v1/admin/templates/5": () =>
        json(200, detail({ id: 5, draft: { code: "po", name: "PO", description: "", groups: [] }, code: "po", name: "PO" })),
      "PUT /api/v1/admin/templates/5/draft": () => json(200, detail({ id: 5, revision: 2, code: "po", name: "PO 2" })),
    });
    renderAt("/templates/new?scope=system");
    expect(await screen.findByText(zh("tpl.targetIs", { owner: zh("tpl.ownerSystem") }))).toBeInTheDocument();
    await userEvent.type(codeInput(), "po");
    await userEvent.type(nameInput(), "PO");
    await userEvent.click(screen.getByRole("button", { name: zh("tpl.saveDraft") }));
    // Navigates to the detail page, which refetches before showing the workbench.
    expect(await screen.findByRole("heading", { name: "PO" }, { timeout: 15_000 })).toBeInTheDocument();
    expect(await api.bodies("POST /api/v1/admin/templates")).toEqual([
      { scope: "system", content: { code: "po", name: "PO", description: "", groups: [] }, source: "manual" },
    ]);

    await userEvent.type(nameInput(), " 2");
    await userEvent.click(screen.getByRole("button", { name: zh("tpl.saveDraft") }));
    await waitFor(() => expect(api.count("PUT /api/v1/admin/templates/5/draft")).toBe(1));
    expect(await api.bodies("PUT /api/v1/admin/templates/5/draft")).toEqual([
      { revision: 1, content: { code: "po", name: "PO 2", description: "", groups: [] }, pending_confirmations: [] },
    ]);
  });

  it("saves a plan grant with exactly the ticked plans", async () => {
    const api = signedIn({
      "GET /api/v1/admin/templates/1": () => json(200, detail()),
      "PUT /api/v1/admin/templates/1/grants": () =>
        json(200, detail({ revision: 2, grant: { mode: "PLANS", plans: ["starter", "intermediate"], users: [], organizations: [] } })),
    });
    renderAt("/templates/1");
    const panel = await screen.findByTestId("template-grants");
    expect(within(panel).getByText(zh("tpl.grant.plansHint"))).toBeInTheDocument();
    await userEvent.click(within(panel).getByRole("checkbox", { name: "Starter" }));
    await userEvent.click(within(panel).getByRole("checkbox", { name: "Intermediate" }));
    await confirm(zh("tpl.grant.save"));
    await waitFor(() => expect(api.count("PUT /api/v1/admin/templates/1/grants")).toBe(1));
    expect(await api.bodies("PUT /api/v1/admin/templates/1/grants")).toEqual([
      { revision: 1, mode: "PLANS", plans: ["starter", "intermediate"], user_ids: [], organization_tenant_ids: [] },
    ]);
    expect(
      await within(panel).findByText(zh("tpl.grant.current", { summary: zh("tpl.grant.plansSummary", { plans: "Starter, Intermediate" }) })),
    ).toBeInTheDocument();
  });

  it("shows activation errors at their place and keeps the draft", async () => {
    signedIn({
      "GET /api/v1/admin/templates/1": () => json(200, detail()),
      "POST /api/v1/admin/templates/1/activate": () =>
        json(422, {
          code: "template_invalid",
          message_key: "error.template_invalid",
          details: { errors: [{ path: "groups[0].items[0].key", message: "server says no" }] },
        }),
    });
    renderAt("/templates/1");
    await confirm(zh("tpl.activate"));
    expect(await screen.findByText(zh("tpl.activateErrors"))).toBeInTheDocument();
    expect(screen.getAllByText(/server says no/).length).toBeGreaterThan(0);
    expect(nameInput()).toHaveValue("Invoice");
  });

  it("a stale revision keeps the local edits and offers a reload", async () => {
    signedIn({
      "GET /api/v1/admin/templates/1": () => json(200, detail()),
      "PUT /api/v1/admin/templates/1/draft": () =>
        json(409, { code: "revision_conflict", message_key: "error.revision_conflict", details: { revision: 3 } }),
    });
    renderAt("/templates/1");
    await screen.findByTestId("template-facts");
    await userEvent.type(nameInput(), " B");
    await userEvent.click(screen.getByRole("button", { name: zh("tpl.saveDraft") }));
    expect(await screen.findByText(zh("tpl.conflict", { revision: 3 }))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: zh("tpl.reload") })).toBeInTheDocument();
    expect(nameInput()).toHaveValue("Invoice B");
  });

  it("a code conflict on create keeps the input and asks for a new code", async () => {
    signedIn({
      "POST /api/v1/admin/templates": () =>
        json(409, { code: "template_code_conflict", message_key: "error.template_code_conflict", details: { code: "po" } }),
    });
    renderAt("/templates/new?scope=tenant&tenant_id=7");
    await userEvent.type(await screen.findByRole("textbox", { name: "编码" }), "po");
    await userEvent.click(screen.getByRole("button", { name: zh("tpl.saveDraft") }));
    expect(await screen.findByText(zh("tpl.codeConflict", { code: "po" }))).toBeInTheDocument();
    expect(codeInput()).toHaveValue("po");
  });
});
