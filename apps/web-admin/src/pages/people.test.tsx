import { screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLanguage } from "../stores/language";
import { json } from "../test/mockApi";
import { renderAt, signedIn, userEvent, zh } from "../test/admin";

beforeEach(() => {
  localStorage.clear();
  useLanguage.getState().setLang("zh");
});

const query = (r: Request) => new URL(r.url).searchParams;
const lastUsers = (api: { calls: Request[] }) => query(api.calls.filter((c) => c.url.includes("/admin/users")).at(-1)!);

describe("admin customer lifecycle", () => {
  it("creates an email account and refreshes the list", async () => {
    const api = signedIn({ "GET /api/v1/admin/users": () => json(200, { items: [], has_more: false }) });
    api.set("POST /api/v1/admin/users", async (r) => {
      const body = await r.json();
      expect(body).toEqual({ email: "new@example.com", display_name: "New User", phone: null, password: "SafePass123" });
      api.set("GET /api/v1/admin/users", () => json(200, { items: [{ ...user(31, body.email), line_linked: false }], has_more: false }));
      return json(201, { ...user(31, body.email), line_linked: false });
    });
    renderAt("/users");
    await userEvent.click(await screen.findByRole("button", { name: "新增用户" }));
    await userEvent.type(screen.getByLabelText("邮箱"), "new@example.com");
    await userEvent.type(screen.getByLabelText("昵称"), "New User");
    await userEvent.type(screen.getByLabelText("初始密码"), "SafePass123");
    await userEvent.click(screen.getByRole("button", { name: "创建用户" }));
    expect(await screen.findByText("new@example.com")).toBeInTheDocument();
    expect(api.count("POST /api/v1/admin/users")).toBe(1);
  });

  it("keeps entered fields when creation is rejected", async () => {
    const api = signedIn({
      "GET /api/v1/admin/users": () => json(200, { items: [], has_more: false }),
      "POST /api/v1/admin/users": () => json(409, { code: "email_taken", fields: ["email"] }),
    });
    renderAt("/users");
    await userEvent.click(await screen.findByRole("button", { name: "新增用户" }));
    await userEvent.type(screen.getByLabelText("邮箱"), "used@example.com");
    await userEvent.type(screen.getByLabelText("昵称"), "New User");
    await userEvent.type(screen.getByLabelText("初始密码"), "SafePass123");
    await userEvent.click(screen.getByRole("button", { name: "创建用户" }));
    expect(await screen.findByText(zh("err.email_taken"))).toBeInTheDocument();
    expect(screen.getByLabelText("邮箱")).toHaveValue("used@example.com");
    expect(screen.getByLabelText("昵称")).toHaveValue("New User");
    expect(api.count("POST /api/v1/admin/users")).toBe(1);
  });

  it("removes the row after a successful hard delete", async () => {
    const api = signedIn({ "GET /api/v1/admin/users": () => json(200, { items: [user(31, "empty@example.com")], has_more: false }) });
    api.set("DELETE /api/v1/admin/users/31", () => {
      api.set("GET /api/v1/admin/users", () => json(200, { items: [], has_more: false }));
      return json(204, null);
    });
    renderAt("/users");
    const row = (await screen.findByText("empty@example.com")).closest("tr")!;
    await userEvent.click(within(row).getByRole("button", { name: "删除用户" }));
    await userEvent.click(screen.getByRole("button", { name: zh("common.confirm") }));
    await waitFor(() => expect(screen.queryByText("empty@example.com")).not.toBeInTheDocument());
    expect(api.count("DELETE /api/v1/admin/users/31")).toBe(1);
  });

  it("requires deletion confirmation and retains a blocked user", async () => {
    const api = signedIn({
      "GET /api/v1/admin/users": () => json(200, { items: [{ ...user(31, "kept@example.com"), line_linked: false }], has_more: false }),
      "DELETE /api/v1/admin/users/31": () => json(409, { code: "user_has_data", fields: [] }),
    });
    renderAt("/users");
    const row = (await screen.findByText("kept@example.com")).closest("tr")!;
    await userEvent.click(within(row).getByRole("button", { name: "删除用户" }));
    await userEvent.click(screen.getByRole("button", { name: zh("common.cancel") }));
    expect(api.count("DELETE /api/v1/admin/users/31")).toBe(0);
    await userEvent.click(within(row).getByRole("button", { name: "删除用户" }));
    await userEvent.click(screen.getByRole("button", { name: zh("common.confirm") }));
    expect(await screen.findByText("用户存在业务数据或历史记录，不能删除。" )).toBeInTheDocument();
    expect(screen.getByText("kept@example.com")).toBeInTheDocument();
  });
});

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
    await waitFor(() => expect(lastUsers(api).get("q")).toBe("somchai"));
    await userEvent.click(within(row).getByRole("link", { name: zh("tenant.ref", { id: 41 }) }));
    expect(await screen.findByRole("heading", { name: zh("billing.title", { id: 41 }) })).toBeInTheDocument();
    expect(screen.getByText(zh("billing.kind.personal"))).toBeInTheDocument();
  });

  it("one character asks for more and sends nothing (070-02)", async () => {
    const api = signedIn({ "GET /api/v1/admin/users": () => json(200, { items: [], has_more: false }) });
    renderAt("/users");
    await waitFor(() => expect(api.count("GET /api/v1/admin/users")).toBe(1)); // the default list
    await userEvent.type(await screen.findByPlaceholderText(zh("users.placeholder")), "s{Enter}");
    expect(await screen.findByText(zh("users.tooShort"))).toBeInTheDocument();
    expect(api.count("GET /api/v1/admin/users")).toBe(1);
  });

  it("a single digit is a user id and is searched", async () => {
    const api = signedIn({ "GET /api/v1/admin/users": () => json(200, { items: [], has_more: false }) });
    renderAt("/users");
    await waitFor(() => expect(api.count("GET /api/v1/admin/users")).toBe(1));
    await userEvent.type(await screen.findByPlaceholderText(zh("users.placeholder")), "7{Enter}");
    await waitFor(() => expect(api.count("GET /api/v1/admin/users")).toBe(2));
    expect(lastUsers(api).get("q")).toBe("7");
  });

  it("opens on every user, page by page (070-03)", async () => {
    const api = signedIn({
      "GET /api/v1/admin/users": (r) => {
        const page = query(r).get("page");
        return page === "2"
          ? json(200, { items: [user(1, "last@example.com")], has_more: false })
          : json(200, { items: [user(2, "first@example.com")], has_more: true });
      },
    });
    renderAt("/users");
    expect(await screen.findByText("first@example.com")).toBeInTheDocument();
    const first = query(api.calls.find((c) => c.url.includes("/admin/users"))!);
    expect(first.get("q") ?? "").toBe("");
    expect(first.get("page")).toBe("1");
    expect(screen.getByText(zh("users.page", { n: 1 }))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: zh("common.prev") })).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: zh("common.next") }));
    expect(await screen.findByText("last@example.com")).toBeInTheDocument();
    expect(screen.getByText(zh("users.page", { n: 2 }))).toBeInTheDocument();
    expect(screen.getByRole("button", { name: zh("common.next") })).toBeDisabled();
  });

  it("clearing the search returns to every user (070-04)", async () => {
    const api = signedIn({
      "GET /api/v1/admin/users": (r) =>
        query(r).get("q")
          ? json(200, { items: [user(3, "somchai@example.com")], has_more: false })
          : json(200, { items: [user(4, "all@example.com"), user(3, "somchai@example.com")], has_more: false }),
    });
    renderAt("/users");
    const box = await screen.findByPlaceholderText(zh("users.placeholder"));
    expect(await screen.findByText("all@example.com")).toBeInTheDocument();
    await userEvent.type(box, "somchai{Enter}");
    await waitFor(() => expect(screen.queryByText("all@example.com")).not.toBeInTheDocument());
    await userEvent.clear(box);
    await userEvent.type(box, "{Enter}");
    expect(await screen.findByText("all@example.com")).toBeInTheDocument();
    expect(lastUsers(api).get("q") ?? "").toBe("");
    expect(screen.queryByText(zh("users.tooShort"))).not.toBeInTheDocument();
  });
});

function user(id: number, email: string) {
  return {
    user_id: id, display_name: `User ${id}`, email, phone: null, registered: true,
    registered_at: "2026-10-01T03:00:00Z", created_at: "2026-10-01T03:00:00Z", personal_tenant_id: null,
  };
}

describe("log in as a user (FR-SYS-146)", () => {
  const LINK = "http://localhost:5174/impersonate#ticket-abc";
  const users = () =>
    json(200, {
      items: [user(3, "somchai@example.com"), { ...user(4, "guest@example.com"), registered: false, registered_at: null }],
      has_more: false,
    });
  const rowOf = async (email: string) => (await screen.findByText(email)).closest("tr") as HTMLElement;
  const confirmIn = async (row: HTMLElement) => {
    await userEvent.click(within(row).getByRole("button", { name: zh("users.impersonate") }));
    expect(await screen.findByText(zh("users.impersonateTitle", { name: "User 3" }))).toBeInTheDocument();
  };

  afterEach(() => vi.restoreAllMocks());

  it("confirms, issues once and opens the link in a new tab (146-01)", async () => {
    const tab = { opener: {} as unknown, location: { href: "" }, close: vi.fn() };
    const open = vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    const api = signedIn({
      "GET /api/v1/admin/users": users,
      "POST /api/v1/admin/users/3/impersonation": () => json(200, { url: LINK, expires_in: 60 }),
    });
    renderAt("/users");
    const row = await rowOf("somchai@example.com");
    const guest = await rowOf("guest@example.com");
    expect(within(guest).queryByRole("button", { name: zh("users.impersonate") })).not.toBeInTheDocument();

    await confirmIn(row);
    await userEvent.click(screen.getByRole("button", { name: zh("common.cancel") }));
    expect(open).not.toHaveBeenCalled();
    expect(api.count("POST /api/v1/admin/users/3/impersonation")).toBe(0);

    await confirmIn(row);
    await userEvent.click(screen.getByRole("button", { name: zh("common.confirm") }));
    await waitFor(() => expect(tab.location.href).toBe(LINK));
    expect(open).toHaveBeenCalledTimes(1);
    expect(tab.opener).toBeNull();
    expect(api.count("POST /api/v1/admin/users/3/impersonation")).toBe(1);
    expect(screen.getByText("somchai@example.com")).toBeInTheDocument();
  });

  it("a blocked tab shows a link to click (146-02)", async () => {
    vi.spyOn(window, "open").mockReturnValue(null);
    signedIn({
      "GET /api/v1/admin/users": users,
      "POST /api/v1/admin/users/3/impersonation": () => json(200, { url: LINK, expires_in: 60 }),
    });
    renderAt("/users");
    await confirmIn(await rowOf("somchai@example.com"));
    await userEvent.click(screen.getByRole("button", { name: zh("common.confirm") }));
    expect(await screen.findByText(zh("users.impersonateBlocked"))).toBeInTheDocument();
    const link = screen.getByRole("link", { name: zh("users.impersonateOpen") });
    expect(link).toHaveAttribute("href", LINK);
    expect(link).toHaveAttribute("target", "_blank");
  });

  it("an error shows the reason and opens nothing (146-02)", async () => {
    const tab = { opener: {} as unknown, location: { href: "" }, close: vi.fn() };
    vi.spyOn(window, "open").mockReturnValue(tab as unknown as Window);
    signedIn({
      "GET /api/v1/admin/users": users,
      "POST /api/v1/admin/users/3/impersonation": () =>
        json(409, { code: "user_not_registered", message_key: "admin.impersonate_unregistered" }),
    });
    renderAt("/users");
    await confirmIn(await rowOf("somchai@example.com"));
    await userEvent.click(screen.getByRole("button", { name: zh("common.confirm") }));
    expect(await screen.findByText(zh("err.user_not_registered"))).toBeInTheDocument();
    expect(tab.close).toHaveBeenCalled();
    expect(tab.location.href).toBe("");
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
