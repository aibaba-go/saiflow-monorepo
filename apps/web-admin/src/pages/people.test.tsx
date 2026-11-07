import { screen, waitFor, within } from "@testing-library/react";
import { beforeEach, describe, expect, it } from "vitest";

import { useLanguage } from "../stores/language";
import { json } from "../test/mockApi";
import { renderAt, signedIn, userEvent, zh } from "../test/admin";

beforeEach(() => {
  localStorage.clear();
  useLanguage.getState().setLang("zh");
});

const query = (r: Request) => new URL(r.url).searchParams;

describe("user search (FR-SYS-070)", () => {
  it("finds Somchai and opens the personal tenant (070-01)", async () => {
    const api = signedIn({
      "GET /api/v1/admin/users": () =>
        json(200, {
          items: [
            {
              user_id: 3, display_name: "Somchai", email: "somchai@example.com", phone: null, registered: true,
              registered_at: "2026-10-01T03:00:00Z", created_at: "2026-10-01T03:00:00Z", personal_tenant_id: 41,
            },
          ],
          has_more: false,
        }),
      "GET /api/v1/admin/tenants/41/subscriptions": () => json(200, []),
      "GET /api/v1/admin/tenants/41/reservations": () => json(200, []),
    });
    renderAt("/users");
    await userEvent.type(await screen.findByPlaceholderText(zh("users.placeholder")), "somchai{Enter}");
    const row = (await screen.findByText("somchai@example.com")).closest("tr") as HTMLElement;
    expect(within(row).getByText("Somchai")).toBeInTheDocument();
    expect(within(row).getByText("2026-10-01 10:00")).toBeInTheDocument();
    expect(query(api.calls.find((c) => c.url.includes("/admin/users"))!).get("q")).toBe("somchai");
    await userEvent.click(within(row).getByRole("link", { name: zh("tenant.ref", { id: 41 }) }));
    expect(await screen.findByRole("heading", { name: zh("billing.title", { id: 41 }) })).toBeInTheDocument();
    expect(screen.getByText(zh("billing.kind.personal"))).toBeInTheDocument();
  });

  it("one character asks for more and sends nothing (070-02)", async () => {
    const api = signedIn({ "GET /api/v1/admin/users": () => json(200, { items: [], has_more: false }) });
    renderAt("/users");
    await userEvent.type(await screen.findByPlaceholderText(zh("users.placeholder")), "s{Enter}");
    expect(await screen.findByText(zh("users.tooShort"))).toBeInTheDocument();
    expect(api.count("GET /api/v1/admin/users")).toBe(0);
  });

  it("a single digit is a user id and is searched", async () => {
    const api = signedIn({ "GET /api/v1/admin/users": () => json(200, { items: [], has_more: false }) });
    renderAt("/users");
    await userEvent.type(await screen.findByPlaceholderText(zh("users.placeholder")), "7{Enter}");
    await waitFor(() => expect(api.count("GET /api/v1/admin/users")).toBe(1));
  });
});

function entry(id: number, action = `org.update.${id}`) {
  return {
    id, occurred_at: "2026-11-01T03:00:00Z", actor_type: "admin", actor_id: "1", action,
    target_type: "tenant", target_id: "5", result: "success",
  };
}

describe("operation log (FR-SYS-071)", () => {
  it("filters by the action prefix org. (071-01)", async () => {
    const api = signedIn({
      "GET /api/v1/admin/audit-log": (r) =>
        json(200, {
          items: query(r).get("action_prefix") === "org." ? [entry(9, "org.disable")] : [entry(9, "org.disable"), entry(8, "plan.update")],
          next_before: null,
        }),
    });
    renderAt("/audit-log");
    expect(await screen.findByText("plan.update")).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText(zh("log.action")), "org.");
    await userEvent.click(screen.getByRole("button", { name: zh("log.search") }));
    await waitFor(() => expect(screen.queryByText("plan.update")).not.toBeInTheDocument());
    const row = screen.getByText("org.disable").closest("tr") as HTMLElement;
    expect(within(row).getByText("2026-11-01 10:00")).toBeInTheDocument();
    expect(within(row).getByText(`${zh("actor.admin")} #1`)).toBeInTheDocument();
    expect(within(row).getByText("tenant #5")).toBeInTheDocument();
    expect(within(row).getByText(zh("log.result.success"))).toBeInTheDocument();
    const last = query(api.calls.at(-1)!);
    expect(last.get("action_prefix")).toBe("org.");
    expect(last.get("limit")).toBe("50");
  });

  it("next page continues with older entries, no overlap (071-02)", async () => {
    const page = (from: number) => Array.from({ length: 50 }, (_, i) => entry(from - i));
    const api = signedIn({
      "GET /api/v1/admin/audit-log": (r) =>
        query(r).get("before") === "71"
          ? json(200, { items: page(70), next_before: 21 })
          : json(200, { items: page(120), next_before: 71 }),
    });
    renderAt("/audit-log");
    expect(await screen.findByText("org.update.120")).toBeInTheDocument();
    expect(screen.getByText("org.update.71")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: zh("log.next") }));
    expect(await screen.findByText("org.update.70")).toBeInTheDocument();
    expect(screen.queryByText("org.update.71")).not.toBeInTheDocument();
    expect(screen.getByText("org.update.21")).toBeInTheDocument();
    expect(query(api.calls.at(-1)!).get("before")).toBe("71");
  });
});

describe("change own password (FR-SYS-061)", () => {
  async function fill(current: string, next: string, again: string) {
    await userEvent.type(await screen.findByLabelText(zh("password.current")), current);
    await userEvent.type(screen.getByLabelText(zh("password.new")), next);
    await userEvent.type(screen.getByLabelText(zh("password.confirm")), again);
    await userEvent.click(screen.getByRole("button", { name: zh("password.submit") }));
  }

  it("changes it and stays signed in (061-01)", async () => {
    const api = signedIn({ "POST /api/v1/admin/me/password": () => json(204, null) });
    renderAt("/password");
    await fill("old-password-123", "new-password-456", "new-password-456");
    expect(await screen.findByText(zh("password.changed"))).toBeInTheDocument();
    expect(await api.bodies("POST /api/v1/admin/me/password")).toEqual([
      { current_password: "old-password-123", new_password: "new-password-456" },
    ]);
    expect(screen.getByText("ops")).toBeInTheDocument();
    expect(screen.getByLabelText(zh("password.new"))).toHaveValue("");
  });

  it("a mismatch and a short password are caught before sending (061-02)", async () => {
    const api = signedIn({ "POST /api/v1/admin/me/password": () => json(204, null) });
    renderAt("/password");
    await fill("old-password-123", "new-password-456", "new-password-457");
    expect(await screen.findByText(zh("password.mismatch"))).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText(zh("password.new")));
    await userEvent.clear(screen.getByLabelText(zh("password.confirm")));
    await userEvent.type(screen.getByLabelText(zh("password.new")), "elevenchars");
    await userEvent.type(screen.getByLabelText(zh("password.confirm")), "elevenchars");
    await userEvent.click(screen.getByRole("button", { name: zh("password.submit") }));
    expect(await screen.findByText(zh("field.new_password"))).toBeInTheDocument();
    expect(api.count("POST /api/v1/admin/me/password")).toBe(0);
  });

  it("a wrong current password shows under it (061-02)", async () => {
    signedIn({
      "POST /api/v1/admin/me/password": () =>
        json(400, { code: "validation_error", fields: ["current_password"] }),
    });
    renderAt("/password");
    await fill("wrong-password-1", "new-password-456", "new-password-456");
    expect(await screen.findByText(zh("field.current_password"))).toBeInTheDocument();
  });
});


describe("operation log fixes (minor-fixes-ui)", () => {
  it("audit log shows translated actor and result", async () => {
    signedIn({ "GET /api/v1/admin/audit-log": () => json(200, { items: [entry(9, "org.disable")], next_before: null }) });
    renderAt("/audit-log");
    const row = (await screen.findByText("org.disable")).closest("tr") as HTMLElement;
    expect(within(row).getByText(`${zh("actor.admin")} #1`)).toBeInTheDocument();
    expect(within(row).getByText(zh("log.result.success"))).toBeInTheDocument();
  });

  it("previous page returns to the first page", async () => {
    const page = (from: number) => Array.from({ length: 50 }, (_, i) => entry(from - i));
    signedIn({
      "GET /api/v1/admin/audit-log": (r) =>
        query(r).get("before") === "71"
          ? json(200, { items: page(70), next_before: 21 })
          : json(200, { items: page(120), next_before: 71 }),
    });
    renderAt("/audit-log");
    await screen.findByText("org.update.120");
    expect(screen.getByRole("button", { name: zh("log.previous") })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: zh("log.next") }));
    await screen.findByText("org.update.70");
    await userEvent.click(screen.getByRole("button", { name: zh("log.previous") }));
    expect(await screen.findByText("org.update.120")).toBeInTheDocument();
  });

  it("until error under the field and until includes the selected minute", async () => {
    const api = signedIn({
      "GET /api/v1/admin/audit-log": (r) =>
        query(r).get("until") ? json(400, { code: "validation_error", fields: ["until"] }) : json(200, { items: [], next_before: null }),
    });
    renderAt("/audit-log");
    await screen.findByRole("button", { name: zh("log.search") });
    const [start, end] = screen.getAllByRole("textbox").filter((el) => el.closest(".ant-picker-range"));
    await userEvent.click(start!);
    await userEvent.type(start!, "2026-11-01 10:00:00{enter}");
    await userEvent.type(end!, "2026-11-01 11:30:00{enter}");
    await userEvent.click(screen.getByRole("button", { name: zh("log.search") }));
    await waitFor(() => expect(query(api.calls.at(-1)!).get("until")).toBe("2026-11-01T11:31:00+07:00"));
    const range = (end!.closest(".ant-form-item") as HTMLElement);
    expect(await within(range).findByText(zh("field.until"))).toBeInTheDocument();
  });
});

describe("operation log action names (minor-fixes-ui, owner check)", () => {
  it("shows the action in the UI language next to its code", async () => {
    signedIn({ "GET /api/v1/admin/audit-log": () => json(200, { items: [entry(9, "admin.login"), entry(8, "result.confirm")], next_before: null }) });
    renderAt("/audit-log");
    const login = (await screen.findByText("admin.login")).closest("tr") as HTMLElement;
    expect(within(login).getByText(zh("action.admin.login"))).toBeInTheDocument();
    const confirm = screen.getByText("result.confirm").closest("tr") as HTMLElement;
    expect(within(confirm).getByText(zh("action.result.confirm"))).toBeInTheDocument();
  });

  it("an unknown action shows its code only", async () => {
    signedIn({ "GET /api/v1/admin/audit-log": () => json(200, { items: [entry(9, "something.new")], next_before: null }) });
    renderAt("/audit-log");
    expect(await screen.findByText("something.new")).toBeInTheDocument();
  });
});
