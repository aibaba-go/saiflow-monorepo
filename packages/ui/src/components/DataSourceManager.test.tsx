import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { DataSourceManager, type DataSourceApi, type SourceMetadata } from "./DataSourceManager";
import type { TableResult } from "./reportTypes";

const PG: SourceMetadata = { id: "postgres:1", name: "ERP", kind: "postgresql", host: "db.example.com", port: 5432, database: "erp", username: "reader", password_configured: true, enabled: true };
const TEMPLATE: SourceMetadata = { id: "template:1", name: "Invoice", kind: "template", enabled: true, password_configured: false };
const SYSTEM: SourceMetadata = { ...PG, id: "system-pg", name: "System PG", kind: "system_pg" };
const RESULT: TableResult = { columns: [{ key: "item", label: "Item", type: "string" }], rows: [{ item: "First page" }], page: 1, page_size: 20, total: 21 };
const user = userEvent.setup({ pointerEventsCheck: 0 });
function service(initial = [PG, TEMPLATE]) {
  let items = initial;
  const api: DataSourceApi = {
    list: async () => ({ items }),
    save: async (body, id) => { items = [{ ...PG, ...body, id: id ?? "postgres:2", password_configured: true }]; return items[0]!; },
    remove: async () => { items = []; }, test: async () => ({ ok: true }),
    query: async (_id, _sql, page) => ({ ...RESULT, page, rows: [{ item: page === 1 ? "First page" : "Last page" }] }),
  };
  return api;
}
async function openEditor() {
  const row = (await screen.findByText("ERP")).closest("tr")!;
  await user.click(within(row).getByRole("button", { name: "Edit" }));
}

describe("data source management (FR-DATA-001..003)", () => {
  it("manages only relational sources even when the catalog includes templates", async () => {
    render(<DataSourceManager api={service()} />);
    const row = (await screen.findByText("ERP")).closest("tr")!;
    expect(within(row).getByRole("button", { name: "Edit" })).toBeInTheDocument();
    expect(screen.queryByText("Invoice")).toBeNull();
    expect(screen.queryByText("Document template")).toBeNull();
    await openEditor();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("ERP")).toBeInTheDocument();
    expect(screen.queryByText("Invoice")).toBeNull();
  });
  it("retains a saved password when editing with a blank password", async () => {
    const api = service(); let password: string | undefined;
    const save = api.save; api.save = async (body, id) => { password = body.password; return save(body, id); };
    render(<DataSourceManager api={api} />); await openEditor();
    expect(screen.getByLabelText("Password")).toHaveValue("");
    expect(screen.getByText("Leave blank to keep the saved password.")).toBeInTheDocument();
    await user.clear(screen.getByLabelText("Source name")); await user.type(screen.getByLabelText("Source name"), "New ERP");
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("New ERP")).toBeInTheDocument(); expect(password).toBe("");
  });
  it("allows PostgreSQL creation with verified TLS and shows connection success", async () => {
    render(<DataSourceManager api={service([])} />);
    await user.click(screen.getByRole("button", { name: "Add PostgreSQL source" }));
    for (const [label, value] of [["Source name", "ERP"], ["Host", "db.example.com"], ["Database", "erp"], ["Username", "reader"], ["Password", "secret"]]) await user.type(screen.getByLabelText(label!), value!);
    expect(screen.getByText("TLS: verify-full")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Save" }));
    const row = (await screen.findByText("ERP")).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Test connection" }));
    expect(await screen.findByRole("status")).toHaveTextContent("Connection successful");
  });
  it("shows a safe error and preserves the form after a rejected save", async () => {
    const api = service(); api.save = async () => { throw new Error("sensitive connection details"); };
    render(<DataSourceManager api={api} />); await openEditor();
    await user.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Operation failed");
    expect(screen.queryByText("sensitive connection details")).toBeNull();
    expect(screen.getByLabelText("Source name")).toHaveValue("ERP");
  });
  it("queries and pages system PG without offering edit or delete", async () => {
    render(<DataSourceManager api={service([SYSTEM])} />);
    const row = (await screen.findByText("System PG")).closest("tr")!;
    expect(within(row).queryByRole("button", { name: "Edit" })).toBeNull();
    expect(within(row).queryByRole("button", { name: "Delete" })).toBeNull();
    await user.click(within(row).getByRole("button", { name: "Query" }));
    await user.type(screen.getByLabelText("SQL"), "SELECT item FROM reporting.jobs");
    await user.click(screen.getByRole("button", { name: "Run query" }));
    expect(await screen.findByText("First page")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Next page" }));
    expect(await screen.findByText("Last page")).toBeInTheDocument(); expect(screen.queryByText("First page")).toBeNull();
  });
  it("removes a pending delete confirmation when the tenant manager leaves", async () => {
    const { unmount } = render(<DataSourceManager api={service()} />);
    const row = (await screen.findByText("ERP")).closest("tr")!;
    await user.click(within(row).getByRole("button", { name: "Delete" }));
    expect((await screen.findAllByText("Delete this data source?")).length).toBeGreaterThan(0);
    unmount();
    await waitFor(() => expect(screen.queryAllByText("Delete this data source?")).toHaveLength(0));
  });
  it("discards a late query after the selected source changes", async () => {
    const api = service(); let finish!: (result: TableResult) => void;
    api.query = async () => new Promise(resolve => { finish = resolve; });
    render(<DataSourceManager api={api} />);
    await user.click(within((await screen.findByText("ERP")).closest("tr")!).getByRole("button", { name: "Query" }));
    await user.type(screen.getByLabelText("SQL"), "SELECT item FROM inventory");
    await user.click(screen.getByRole("button", { name: "Run query" })); await waitFor(() => expect(finish).toBeTypeOf("function"));
    await user.click(screen.getByRole("button", { name: "Close query" }));
    await act(async () => { finish(RESULT); });
    expect(screen.queryByText("First page")).toBeNull();
  });
});
