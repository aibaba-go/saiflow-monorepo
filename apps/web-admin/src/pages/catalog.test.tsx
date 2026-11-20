import { act, screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { translate } from "../i18n";
import { useLanguage } from "../stores/language";
import { json } from "../test/mockApi";
import { renderAt, signedIn, userEvent, zh } from "../test/admin";

beforeEach(() => {
  localStorage.clear();
  useLanguage.getState().setLang("zh");
});

function plans() {
  return [
    { code: "kinder", monthly_quota: 100, member_limit: 1, tenant_kind: "personal", monthly_price: null, yearly_price: null },
    { code: "starter", monthly_quota: 3000, member_limit: 5, tenant_kind: "organization", monthly_price: "599.00", yearly_price: "5990.00" },
    { code: "intermediate", monthly_quota: 10000, member_limit: 20, tenant_kind: "organization", monthly_price: "1190.00", yearly_price: null },
    { code: "advance", monthly_quota: 50000, member_limit: null, tenant_kind: "organization", monthly_price: null, yearly_price: null },
  ];
}

const rowOf = async (text: string) => (await screen.findByText(text)).closest("tr") as HTMLElement;

async function editPlan(name: string) {
  await userEvent.click(within(await rowOf(name)).getByRole("button", { name: zh("plans.edit") }));
  return screen.findByRole("dialog");
}

async function retype(input: HTMLElement, value: string) {
  await userEvent.clear(input);
  if (value) await userEvent.type(input, value);
}

async function confirmSave(scope: HTMLElement, label = zh("common.save")) {
  await userEvent.click(within(scope).getByRole("button", { name: label }));
  await userEvent.click(await screen.findByRole("button", { name: zh("common.confirm") }));
}

describe("plans (FR-SYS-068)", () => {
  it("changes the Intermediate price and quota after confirming (068-01)", async () => {
    const rows = plans();
    const api = signedIn({
      "GET /api/v1/admin/plans": () => json(200, rows),
      "PATCH /api/v1/admin/plans/intermediate": async (r) => {
        const body = (await r.json()) as { monthly_quota: number; monthly_price: string };
        Object.assign(rows[2]!, { monthly_quota: body.monthly_quota, monthly_price: `${body.monthly_price}.00` });
        return json(200, rows[2]);
      },
    });
    renderAt("/plans");
    const dialog = await editPlan("Intermediate");
    await retype(within(dialog).getByLabelText(zh("plans.monthlyPrice")), "1290");
    await retype(within(dialog).getByLabelText(zh("plans.quota")), "12000");
    await confirmSave(dialog);
    const row = await rowOf("Intermediate");
    expect(await within(row).findByText("฿1,290.00")).toBeInTheDocument();
    expect(within(row).getByText("12,000")).toBeInTheDocument();
    expect(await api.bodies("PATCH /api/v1/admin/plans/intermediate")).toEqual([
      { monthly_quota: 12000, monthly_price: "1290" },
    ]);
  });

  it("shows Kinder's member limit as 1 and not editable (068-02)", async () => {
    signedIn({ "GET /api/v1/admin/plans": () => json(200, plans()) });
    renderAt("/plans");
    const dialog = await editPlan("Kinder");
    expect(within(dialog).queryByLabelText(zh("plans.memberLimit"))).not.toBeInTheDocument();
    expect(within(dialog).getByText(zh("plans.kinderLimit"))).toBeInTheDocument();
  });

  it("an empty price is sent as null (contact us); unlimited shows as such", async () => {
    const api = signedIn({
      "GET /api/v1/admin/plans": () => json(200, plans()),
      "PATCH /api/v1/admin/plans/starter": () => json(200, plans()[1]),
    });
    renderAt("/plans");
    expect(within(await rowOf("Advance")).getByText(zh("plans.unlimited"))).toBeInTheDocument();
    const dialog = await editPlan("Starter");
    await retype(within(dialog).getByLabelText(zh("plans.yearlyPrice")), "");
    await confirmSave(dialog);
    await waitFor(async () =>
      expect(await api.bodies("PATCH /api/v1/admin/plans/starter")).toEqual([{ yearly_price: null }]),
    );
  });

  it("a negative price and a zero quota show errors under them (068-03)", async () => {
    signedIn({
      "GET /api/v1/admin/plans": () => json(200, plans()),
      "PATCH /api/v1/admin/plans/starter": () =>
        json(400, { code: "validation_error", fields: ["monthly_quota", "monthly_price"] }),
    });
    renderAt("/plans");
    const dialog = await editPlan("Starter");
    await retype(within(dialog).getByLabelText(zh("plans.monthlyPrice")), "-1");
    await retype(within(dialog).getByLabelText(zh("plans.quota")), "0");
    await confirmSave(dialog);
    expect(await within(dialog).findByText(zh("field.monthly_price"))).toBeInTheDocument();
    expect(within(dialog).getByText(zh("field.monthly_quota"))).toBeInTheDocument();
  });
});

describe("parameters (FR-SYS-069)", () => {
  const settings = () => ({
    "GET /api/v1/admin/settings/free-quota-personal": () => json(200, { value: 100 }),
    "GET /api/v1/admin/settings/free-quota-organization": () => json(200, { value: 100 }),
    "GET /api/v1/admin/settings/org-member-limit-unpaid": () => json(200, { value: 2 }),
  });

  it("saves the organization free quota 200 and explains it applies to later grants (069-01)", async () => {
    let org = 100;
    const api = signedIn({
      ...settings(),
      "GET /api/v1/admin/settings/free-quota-organization": () => json(200, { value: org }),
      "PUT /api/v1/admin/settings/free-quota-organization": async (r) => {
        org = ((await r.json()) as { value: number }).value;
        return json(200, { value: org });
      },
    });
    renderAt("/settings");
    expect(await screen.findByText(zh("settings.freeNote"))).toBeInTheDocument();
    const card = screen.getByTestId("setting-free-quota-organization");
    await retype(await within(card).findByDisplayValue("100"), "200");
    await userEvent.click(within(card).getByRole("button", { name: zh("common.save") }));
    expect(api.count("PUT /api/v1/admin/settings/free-quota-organization")).toBe(0);
    await userEvent.click(await screen.findByRole("button", { name: zh("common.confirm") }));
    expect(await within(card).findByText(zh("settings.saved"))).toBeInTheDocument();
    expect(await api.bodies("PUT /api/v1/admin/settings/free-quota-organization")).toEqual([{ value: 200 }]);
    expect(within(card).getByDisplayValue("200")).toBeInTheDocument();
  });

  it("a member limit of 0 shows an error under it (069-02)", async () => {
    signedIn({
      ...settings(),
      "PUT /api/v1/admin/settings/org-member-limit-unpaid": () =>
        json(400, { code: "validation_error", fields: ["value"] }),
    });
    renderAt("/settings");
    const card = await screen.findByTestId("setting-org-member-limit-unpaid");
    await retype(await within(card).findByDisplayValue("2"), "0");
    await userEvent.click(within(card).getByRole("button", { name: zh("common.save") }));
    await userEvent.click(await screen.findByRole("button", { name: zh("common.confirm") }));
    expect(await within(card).findByText(zh("field.value"))).toBeInTheDocument();
  });
});

describe("OCR and LLM settings (FR-SYS-072)", () => {
  const defaults = () => ({
    primary_engine: "textin", backup_engine: "google_docai", retry_per_document: 3, switch_threshold: 5,
    probe_interval_seconds: 300, llm_base_url: "https://api.deepseek.com", llm_model: "deepseek-flash",
    keys: { textin: true, google_docai: false, llm: true },
    // never shown even if a key ever leaked into the response
    llm_api_key: "sk-very-secret",
  });

  it("shows the defaults and key status, saves retry 2 after confirming (072-01)", async () => {
    const current = defaults();
    const api = signedIn({
      "GET /api/v1/admin/ocr-settings": () => json(200, current),
      "PATCH /api/v1/admin/ocr-settings": async (r) => {
        Object.assign(current, await r.json());
        return json(200, current);
      },
    });
    renderAt("/ocr");
    const form = await screen.findByTestId("ocr-form");
    expect(within(form).getByTitle("TextIn")).toBeInTheDocument();
    expect(within(form).getByTitle("Google Document AI OCR")).toBeInTheDocument();
    const keys = screen.getByTestId("ocr-keys");
    expect(within(keys).getAllByText(zh("ocr.keySet"))).toHaveLength(2);
    expect(within(keys).getAllByText(zh("ocr.keyMissing"))).toHaveLength(1);
    expect(screen.getByText(zh("ocr.keyNote"))).toBeInTheDocument();
    expect(document.body.textContent).not.toContain("sk-very-secret");
    await retype(within(form).getByLabelText(zh("ocr.retry")), "2");
    await confirmSave(form);
    await waitFor(async () =>
      expect(await api.bodies("PATCH /api/v1/admin/ocr-settings")).toEqual([{ retry_per_document: 2 }]),
    );
    expect(await within(await screen.findByTestId("ocr-form")).findByDisplayValue("2")).toBeInTheDocument();
  });

  it("shows the backend's errors under the backup engine and the LLM URL (072-02)", async () => {
    signedIn({
      "GET /api/v1/admin/ocr-settings": () => json(200, defaults()),
      "PATCH /api/v1/admin/ocr-settings": () =>
        json(400, { code: "validation_error", fields: ["backup_engine", "llm_base_url"] }),
    });
    renderAt("/ocr");
    const form = await screen.findByTestId("ocr-form");
    await retype(within(form).getByLabelText(zh("ocr.llmBaseUrl")), "http://api.deepseek.com");
    await confirmSave(form);
    expect(await within(form).findByText(zh("field.backup_engine"))).toBeInTheDocument();
    expect(within(form).getByText(zh("field.llm_base_url"))).toBeInTheDocument();
  });

  async function choose(id: string, name: string) {
    await userEvent.click(document.getElementById(id)!);
    const options = await screen.findAllByText(name, { selector: ".ant-select-item-option-content" });
    await userEvent.click(options.at(-1)!);
  }
  const selected = (id: string) => document.getElementById(id)!.closest(".ant-select")!;

  it.each([false, true])("confirmed unchanged settings do not PATCH, swapped back=%s (162-01/03)", async (swappedBack) => {
    const current = defaults();
    const api = signedIn({
      "GET /api/v1/admin/ocr-settings": () => json(200, current),
      "PATCH /api/v1/admin/ocr-settings": () => json(200, current),
    });
    renderAt("/ocr");
    const form = await screen.findByTestId("ocr-form");
    if (swappedBack) {
      await choose("ocr-primary", "Google Document AI OCR");
      expect(selected("ocr-backup")).toHaveTextContent("TextIn");
      await choose("ocr-primary", "TextIn");
    }
    expect(selected("ocr-primary")).toHaveTextContent("TextIn");
    expect(selected("ocr-backup")).toHaveTextContent("Google Document AI OCR");
    await confirmSave(form);
    await screen.findByText(zh("plans.noChange"));
    expect(api.count("PATCH /api/v1/admin/ocr-settings")).toBe(0);
    expect(current).toEqual(defaults());
  });

  it.each([
    ["textin", "google_docai", "Google Document AI OCR", "TextIn"],
    ["google_docai", "textin", "TextIn", "Google Document AI OCR"],
  ])("swaps %s to %s atomically, preserves other inputs and reopens (162-01/02)", async (old, next, nextName, oldName) => {
    const current = { ...defaults(), primary_engine: old, backup_engine: next };
    const api = signedIn({
      "GET /api/v1/admin/ocr-settings": () => json(200, current),
      "PATCH /api/v1/admin/ocr-settings": async (r) => {
        Object.assign(current, await r.json());
        return json(200, current);
      },
    });
    const view = renderAt("/ocr");
    const form = await screen.findByTestId("ocr-form");
    await retype(within(form).getByLabelText(zh("ocr.llmModel")), "custom-model");
    await choose("ocr-primary", nextName!);
    expect(selected("ocr-primary")).toHaveTextContent(nextName!);
    expect(selected("ocr-backup")).toHaveTextContent(oldName!);
    expect(within(form).getByLabelText(zh("ocr.llmModel"))).toHaveValue("custom-model");
    await userEvent.click(within(form).getByRole("button", { name: zh("common.save") }));
    expect(api.count("PATCH /api/v1/admin/ocr-settings")).toBe(0);
    await userEvent.click(await screen.findByRole("button", { name: zh("common.confirm") }));
    await waitFor(async () => expect(await api.bodies("PATCH /api/v1/admin/ocr-settings")).toEqual([
      { primary_engine: next, backup_engine: old, llm_model: "custom-model" },
    ]));
    await screen.findByText(zh("ocr.saved"));
    view.unmount();
    renderAt("/ocr");
    await screen.findByTestId("ocr-form");
    expect(selected("ocr-primary")).toHaveTextContent(nextName!);
    expect(selected("ocr-backup")).toHaveTextContent(oldName!);
    expect(screen.getByLabelText(zh("ocr.llmModel"))).toHaveValue("custom-model");
    expect(screen.getByLabelText(zh("ocr.retry"))).toHaveValue("3");
    expect(screen.getByLabelText(zh("ocr.threshold"))).toHaveValue("5");
    expect(screen.getByLabelText(zh("ocr.probe"))).toHaveValue("300");
  });

  it("keeps none and the model draft on cancel; saves only changed fields (162-03)", async () => {
    const current = { ...defaults(), backup_engine: "none" };
    const api = signedIn({
      "GET /api/v1/admin/ocr-settings": () => json(200, current),
      "PATCH /api/v1/admin/ocr-settings": async (r) => {
        Object.assign(current, await r.json());
        return json(200, current);
      },
    });
    renderAt("/ocr");
    const form = await screen.findByTestId("ocr-form");
    await retype(within(form).getByLabelText(zh("ocr.llmModel")), "draft-model");
    await choose("ocr-primary", "Google Document AI OCR");
    await userEvent.click(within(form).getByRole("button", { name: zh("common.save") }));
    await userEvent.click(await screen.findByRole("button", { name: zh("common.cancel") }));
    expect(selected("ocr-backup")).toHaveTextContent(zh("ocr.none"));
    expect(screen.getByLabelText(zh("ocr.llmModel"))).toHaveValue("draft-model");
    expect(api.count("PATCH /api/v1/admin/ocr-settings")).toBe(0);
    expect(current.primary_engine).toBe("textin");
    expect(current.llm_model).toBe("deepseek-flash");
    await confirmSave(form);
    await waitFor(async () => expect(await api.bodies("PATCH /api/v1/admin/ocr-settings")).toEqual([
      { primary_engine: "google_docai", llm_model: "draft-model" },
    ]));
  });

  it("keeps conflicting backup and invalid URL on whole-form 400, translated in both languages (162-04/05)", async () => {
    const current = defaults();
    const api = signedIn({
      "GET /api/v1/admin/ocr-settings": () => json(200, current),
      "PATCH /api/v1/admin/ocr-settings": () => json(400, { code: "validation_error", fields: ["backup_engine", "llm_base_url"] }),
    });
    renderAt("/ocr");
    const form = await screen.findByTestId("ocr-form");
    await choose("ocr-primary", "Google Document AI OCR");
    await choose("ocr-backup", "Google Document AI OCR");
    await retype(screen.getByLabelText(zh("ocr.llmBaseUrl")), "http://invalid.example");
    await confirmSave(form);
    expect(await screen.findByText(zh("field.backup_engine"))).toBeInTheDocument();
    expect(screen.getByText(zh("field.llm_base_url"))).toBeInTheDocument();
    expect(selected("ocr-primary")).toHaveTextContent("Google Document AI OCR");
    expect(selected("ocr-backup")).toHaveTextContent("Google Document AI OCR");
    expect(screen.getByLabelText(zh("ocr.llmBaseUrl"))).toHaveValue("http://invalid.example");
    await act(() => useLanguage.getState().setLang("en"));
    expect(screen.getByText(translate("en", "field.backup_engine"))).toBeInTheDocument();
    expect(screen.getByText(translate("en", "field.llm_base_url"))).toBeInTheDocument();
    expect(await api.bodies("PATCH /api/v1/admin/ocr-settings")).toEqual([
      { primary_engine: "google_docai", llm_base_url: "http://invalid.example" },
    ]);
    expect(current).toEqual(defaults());
  });

  it.each(["zh", "en"] as const)("explains default/failure backup in %s, with no secret or duplicate pending write (162-05)", async (lang) => {
    useLanguage.getState().setLang(lang);
    const tr = (key: Parameters<typeof translate>[1]) => translate(lang, key);
    let finish!: () => void;
    const pending = new Promise<void>((resolve) => { finish = resolve; });
    const current = defaults();
    const api = signedIn({
      "GET /api/v1/admin/ocr-settings": () => json(200, current),
      "PATCH /api/v1/admin/ocr-settings": async (r) => {
        await pending;
        Object.assign(current, await r.json());
        return json(200, current);
      },
    });
    renderAt("/ocr");
    const form = await screen.findByTestId("ocr-form");
    expect(screen.getByText(tr("ocr.primaryNote"))).toBeInTheDocument();
    expect(screen.getByText(tr("ocr.backupNote"))).toBeInTheDocument();
    expect(within(screen.getByTestId("ocr-keys")).getAllByText(tr("ocr.keySet"))).toHaveLength(2);
    await choose("ocr-primary", "Google Document AI OCR");
    expect(api.count("PATCH /api/v1/admin/ocr-settings")).toBe(0);
    const saveButton = within(form).getByRole("button", { name: tr("common.save") });
    await userEvent.click(saveButton);
    await userEvent.click(await screen.findByRole("button", { name: tr("common.confirm") }));
    await waitFor(() => expect(api.count("PATCH /api/v1/admin/ocr-settings")).toBe(1));
    // Ant Design's loading icon changes the accessible name while the same button is pending.
    await userEvent.click(saveButton);
    expect(api.count("PATCH /api/v1/admin/ocr-settings")).toBe(1);
    expect(document.body.textContent).not.toContain("sk-very-secret");
    finish();
    await screen.findByText(tr("ocr.saved"));
    expect(await api.bodies("PATCH /api/v1/admin/ocr-settings")).toEqual([
      { primary_engine: "google_docai", backup_engine: "textin" },
    ]);
    expect(document.body.textContent).not.toContain("sk-very-secret");
  });
});
