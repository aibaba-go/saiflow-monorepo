import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import type { Sample, TemplateDetail, TemplateSummary } from "../templates/api";
import { en, renderAt, signedIn, userEvent } from "../test/app";
import { ORG, PERSONAL } from "../test/fixtures";
import { json } from "../test/mockApi";
import { useTenantChoice } from "../tenants/useCurrentTenant";
import { useLanguage } from "../stores/language";

const LONG = 30_000;
const WAIT = { timeout: 10_000 };
const LIST = "GET /api/v1/managed-templates";
const ONE = "GET /api/v1/managed-templates/12";

const field = (key: string, name: string, extra: Record<string, unknown> = {}) => ({
  kind: "field",
  key,
  name,
  description: "",
  type: "string",
  required: false,
  primary: false,
  role: null,
  ...extra,
});
const VALID = {
  code: "invoice",
  name: "Invoice",
  description: "",
  groups: [
    {
      key: "header",
      name: "Header",
      description: "",
      items: [field("number", "Number", { primary: true }), field("total", "Total", { type: "amount" })],
    },
  ],
};

const detail = (over: Partial<TemplateDetail> = {}): TemplateDetail => ({
  id: 12,
  code: "invoice",
  name: "Invoice",
  scope: "personal",
  status: "ENABLED",
  tenant_id: 70,
  can_manage: true,
  current: null,
  current_version: null,
  deletable: true,
  draft: VALID,
  draft_errors: [],
  has_draft: true,
  pending_confirmations: [],
  protected_reasons: [],
  revision: 3,
  updated_at: "2026-11-10T03:00:00Z",
  versions: [],
  ...over,
});
const summary = (over: Partial<TemplateSummary> = {}) => {
  const { id, code, name, scope, status, can_manage, current_version, deletable, has_draft, protected_reasons, revision, updated_at } =
    detail();
  return {
    ...{ id, code, name, scope, status, can_manage, current_version, deletable, has_draft, protected_reasons, revision, updated_at },
    ...over,
  };
};

beforeEach(() => {
  localStorage.clear();
  useTenantChoice.getState().reset();
  useLanguage.getState().setLang("en");
});

const menuLinks = async () =>
  within(await screen.findByRole("menu", {}, WAIT))
    .getAllByRole("link")
    .map((a) => a.textContent);

describe("template menu and list (FR-SYS-140)", () => {
  it(
    "shows the menu item and the list in the personal account",
    async () => {
      signedIn({ [LIST]: () => json(200, { items: [summary()] }), "GET /api/v1/template-samples": () => json(200, { items: [] }) });
      renderAt("/templates");
      expect(await menuLinks()).toContain(en("nav.templates"));
      const row = (await screen.findByText("Invoice", {}, WAIT)).closest("tr") as HTMLElement;
      expect(within(row).getByText(en("tpl.scope.personal"))).toBeInTheDocument();
      expect(within(row).getByText(en("tpl.notActive"))).toBeInTheDocument();
      expect(within(row).getByText(en("tpl.draft"))).toBeInTheDocument();
      expect(within(row).getByRole("button", { name: en("tpl.edit") })).toBeInTheDocument();
      expect(screen.getByRole("button", { name: en("tpl.fromSample") })).toBeInTheDocument();
    },
    LONG,
  );

  it(
    "hides it in an organization without template_manage; a direct visit is refused",
    async () => {
      localStorage.setItem("saiflow.pc.tenant.7", "5");
      useTenantChoice.getState().reset();
      const api = signedIn({ [LIST]: () => json(200, { items: [] }) }, { tenants: [PERSONAL, ORG] });
      renderAt("/templates");
      expect(await screen.findByText(en("tpl.noAccess"), {}, WAIT)).toBeInTheDocument();
      expect(await menuLinks()).not.toContain(en("nav.templates"));
      expect(api.count(LIST)).toBe(0);
    },
    LONG,
  );

  it(
    "shows it to a template_manage holder of the organization",
    async () => {
      localStorage.setItem("saiflow.pc.tenant.7", "5");
      useTenantChoice.getState().reset();
      const org = { ...ORG, permissions: [...ORG.permissions, "template_manage"] } as typeof ORG;
      signedIn({ [LIST]: () => json(200, { items: [] }), "GET /api/v1/template-samples": () => json(200, { items: [] }) }, { tenants: [PERSONAL, org] });
      renderAt("/templates");
      expect(await screen.findByText(en("tpl.empty"), {}, WAIT)).toBeInTheDocument();
      expect(await menuLinks()).toContain(en("nav.templates"));
    },
    LONG,
  );
});

describe("create and edit (FR-TEMPLATE-001/005)", () => {
  it(
    "creates a blank template, then saves a draft with the revision it was based on",
    async () => {
      let stored = detail();
      const api = signedIn({
        "POST /api/v1/managed-templates": async (r) => {
          const body = (await r.json()) as { content: TemplateDetail["draft"] };
          stored = detail({ draft: body.content, has_draft: true });
          return json(201, stored);
        },
        [ONE]: () => json(200, stored),
        "PUT /api/v1/managed-templates/12/draft": async (r) => {
          const body = (await r.json()) as { content: TemplateDetail["draft"] };
          stored = detail({ draft: body.content, revision: 4 });
          return json(200, stored);
        },
      });
      renderAt("/templates/new");
      const code = (await screen.findAllByRole("textbox", { name: en("te.code") }, WAIT))[0]!;
      // an untouched blank form shows no problems yet
      expect(code).not.toHaveAttribute("aria-invalid", "true");
      await userEvent.type(code, "invoice");
      expect(screen.getAllByRole("textbox", { name: en("te.name") })[0]).toHaveAccessibleDescription(en("te.err.empty"));
      await userEvent.type(screen.getAllByRole("textbox", { name: en("te.name") })[0]!, "Invoice");
      await userEvent.click(screen.getByRole("button", { name: en("tpl.save") }));

      expect(await screen.findByRole("button", { name: en("tpl.saveDraft") }, WAIT)).toBeDisabled();
      const [created] = (await api.bodies("POST /api/v1/managed-templates")) as { source: string; content: { code: string; name: string } }[];
      expect(created).toMatchObject({ source: "manual", content: { code: "invoice", name: "Invoice" } });

      await userEvent.type(screen.getAllByRole("textbox", { name: en("te.name") })[0]!, " 2");
      await userEvent.click(screen.getByRole("button", { name: en("tpl.saveDraft") }));
      await waitFor(() => expect(api.count("PUT /api/v1/managed-templates/12/draft")).toBe(1));
      const [saved] = (await api.bodies("PUT /api/v1/managed-templates/12/draft")) as { revision: number; content: { name: string } }[];
      expect(saved).toMatchObject({ revision: 3, content: { name: "Invoice 2" } });
      expect(await screen.findByText(en("tpl.saved"), {}, WAIT)).toBeInTheDocument();
    },
    LONG,
  );

  it(
    "a taken code keeps the input and explains how to save a copy",
    async () => {
      signedIn({
        "POST /api/v1/managed-templates": () =>
          json(409, { code: "template_code_conflict", message_key: "error.template_code_conflict", details: { code: "invoice" } }),
      });
      renderAt("/templates/new");
      const code = (await screen.findAllByRole("textbox", { name: en("te.code") }, WAIT))[0]!;
      await userEvent.type(code, "invoice");
      await userEvent.click(screen.getByRole("button", { name: en("tpl.save") }));
      expect(await screen.findByText(en("tpl.codeConflict", { code: "invoice" }), {}, WAIT)).toBeInTheDocument();
      expect(code).toHaveValue("invoice");
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent(en("tpl.newTitle"));
    },
    LONG,
  );

  it(
    "a refused activation shows the server's path errors in the editor",
    async () => {
      const api = signedIn({
        [ONE]: () => json(200, detail()),
        "POST /api/v1/managed-templates/12/activate": () =>
          json(422, {
            code: "template_invalid",
            message_key: "error.template_invalid",
            details: { errors: [{ path: "groups[0].items[0].key", message: "duplicate item key 'number' in group" }] },
          }),
      });
      renderAt("/templates/12");
      await userEvent.click(await screen.findByRole("button", { name: en("tpl.activate") }, WAIT));
      expect(await screen.findByText(en("tpl.invalid"), {}, WAIT)).toBeInTheDocument();
      const key = within(screen.getByRole("group", { name: "Number" })).getByRole("textbox", { name: en("te.key") });
      expect(key).toHaveAccessibleDescription(en("te.err.duplicateItem").replace("{key}", "number"));
      const [body] = (await api.bodies("POST /api/v1/managed-templates/12/activate")) as { revision: number }[];
      expect(body).toEqual({ revision: 3 });
    },
    LONG,
  );
});

describe("delete protection (FR-TEMPLATE-009)", () => {
  it(
    "disables Delete with the reason while the template is in use",
    async () => {
      signedIn({ [ONE]: () => json(200, detail({ deletable: false, protected_reasons: ["applied"] })) });
      renderAt("/templates/12");
      const del = await screen.findByRole("button", { name: en("tpl.delete") }, WAIT);
      expect(del).toBeDisabled();
      await userEvent.hover(del.parentElement!);
      expect(await screen.findByText(en("tpl.cannotDelete", { reasons: en("tpl.protected.applied") }), {}, WAIT)).toBeInTheDocument();
    },
    LONG,
  );

  it(
    "explains a 409 template_in_use and stays on the page",
    async () => {
      signedIn({
        [ONE]: () => json(200, detail()),
        "DELETE /api/v1/managed-templates/12": () =>
          json(409, { code: "template_in_use", message_key: "error.template_in_use", details: { reasons: ["applied"] } }),
      });
      renderAt("/templates/12");
      await userEvent.click(await screen.findByRole("button", { name: en("tpl.delete") }, WAIT));
      await userEvent.click(await screen.findByRole("button", { name: en("common.confirm") }, WAIT));
      expect(await screen.findByText(en("err.template_in_use"), {}, WAIT)).toBeInTheDocument();
      expect(screen.getByRole("heading", { level: 1 })).toHaveTextContent("Invoice");
    },
    LONG,
  );
});

describe("sample to draft (FR-TEMPLATE-008)", () => {
  it(
    "saves the candidate with the sample id and the suggestions still to confirm",
    async () => {
      const sample: Sample = {
        id: "S1",
        status: "READY",
        source: "UPLOAD",
        charged_pages: 1,
        created_at: "2026-11-10T03:00:00Z",
        expires_at: "2026-11-17T03:00:00Z",
        ready_at: "2026-11-10T03:01:00Z",
        error_code: null,
        failed_stage: null,
        file_kind: "png",
        pages: 1,
        candidate: {
          content: VALID,
          values: { "header.number": "INV-001" },
          suggestions: [
            { path: "groups[0].items[0]", attr: "required", value: true },
            { path: "groups[0].items[1]", attr: "role", value: "grand_total" },
          ],
        },
      };
      const api = signedIn({
        "GET /api/v1/template-samples/S1": () => json(200, sample),
        "GET /api/v1/template-samples/S1/pages/1": () => new Response(new Blob(["x"])),
        "POST /api/v1/managed-templates": () => json(201, detail()),
        [ONE]: () => json(200, detail()),
      });
      renderAt("/templates/samples/S1");
      const row = await screen.findByRole("group", { name: "Number" }, WAIT);
      await userEvent.click(within(row).getByRole("button", { name: en("te.accept") }));
      await userEvent.click(screen.getByRole("button", { name: en("sample.saveDraft") }));
      await waitFor(() => expect(api.count("POST /api/v1/managed-templates")).toBe(1));
      const [body] = (await api.bodies("POST /api/v1/managed-templates")) as Record<string, unknown>[];
      expect(body).toMatchObject({
        source: "sample",
        sample_id: "S1",
        pending_confirmations: [{ path: "groups[0].items[1]", attr: "role", value: "grand_total" }],
        content: { code: "invoice", groups: [{ items: [{ key: "number", required: true }, { key: "total" }] }] },
      });
      expect(JSON.stringify(body)).not.toContain("INV-001");
      expect(await screen.findByRole("button", { name: en("tpl.activate") }, WAIT)).toBeInTheDocument();
    },
    LONG,
  );
});
