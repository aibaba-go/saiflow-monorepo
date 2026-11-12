import { act, screen, waitFor } from "@testing-library/react";
import userEventLib from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { useLanguage } from "../../stores/language";
import { useSession } from "../../stores/session";
import { signedIn, UNREGISTERED, USER } from "../../test/fixtures";
import { json, mockApi } from "../../test/mockApi";
import { renderWithProviders } from "../../test/render";
import { RegisterDialog } from "../auth/RegisterDialog";
import { useRequireRegistered } from "../auth/useRequireRegistered";
import { ProfilePage } from "./ProfilePage";

const userEvent = userEventLib.setup({ pointerEventsCheck: 0 });

beforeEach(() => {
  localStorage.clear();
  useLanguage.getState().setLang("en");
});
afterEach(() => {
  vi.useRealTimers();
});

function CreateOrgButton() {
  const requireRegistered = useRequireRegistered();
  return (
    <button type="button" onClick={() => void requireRegistered()}>
      Create organization
    </button>
  );
}

function openDialog() {
  signedIn(UNREGISTERED);
  useSession.setState({ registerOpen: true });
  return renderWithProviders(
    <>
      <RegisterDialog />
      <CreateOrgButton />
    </>,
  );
}

describe("registration (FR-SYS-042)", () => {
  it("prefills, sends a code, registers (042-01)", async () => {
    const registered = { ...USER, email: "line@example.com" };
    const api = mockApi({
      "POST /api/v1/me/email-code": () => json(204, null),
      "POST /api/v1/me/registration": () => json(200, registered),
      "GET /api/v1/me": () => json(200, registered),
      "GET /api/v1/me/tenants": () => json(200, []),
    });
    openDialog();
    expect(await screen.findByLabelText("Email")).toHaveValue("line@example.com");
    expect(screen.getByLabelText("Nickname")).toHaveValue("New User");
    await userEvent.click(screen.getByRole("button", { name: "Send code" }));
    await userEvent.type(screen.getByLabelText("Verification code"), "123456");
    await userEvent.type(screen.getByLabelText("Password"), "abcd1234");
    await userEvent.type(screen.getByLabelText("Confirm password"), "abcd1234");
    await userEvent.click(screen.getByRole("button", { name: "Register" }));
    await waitFor(() => expect(useSession.getState().registerOpen).toBe(false));
    expect(useSession.getState().me?.registered).toBe(true);
    expect(await api.bodies("POST /api/v1/me/registration")).toEqual([
      { email: "line@example.com", code: "123456", password: "abcd1234", display_name: "New User", phone: "" },
    ]);
  });

  it("counts down 60 s before another code (042-02)", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    const timedUser = userEventLib.setup({
      pointerEventsCheck: 0,
      advanceTimers: vi.advanceTimersByTime,
    });
    mockApi({ "POST /api/v1/me/email-code": () => json(204, null) });
    openDialog();
    await timedUser.click(await screen.findByRole("button", { name: "Send code" }));
    expect(await screen.findByRole("button", { name: "60s" })).toBeDisabled();
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByRole("button", { name: "30s" })).toBeDisabled();
    act(() => {
      vi.advanceTimersByTime(30_000);
    });
    expect(screen.getByRole("button", { name: "Send code" })).toBeEnabled();
  });

  it("a wrong code keeps what was typed (042-03)", async () => {
    mockApi({
      "POST /api/v1/me/email-code": () => json(204, null),
      "POST /api/v1/me/registration": () =>
        json(400, { code: "email_code_invalid", message_key: "x", fields: ["code"] }),
    });
    openDialog();
    await userEvent.type(await screen.findByLabelText("Phone (optional)"), "0899999999");
    await userEvent.click(screen.getByRole("button", { name: "Send code" }));
    await userEvent.type(screen.getByLabelText("Verification code"), "000000");
    await userEvent.type(screen.getByLabelText("Password"), "abcd1234");
    await userEvent.type(screen.getByLabelText("Confirm password"), "abcd1234");
    await userEvent.click(screen.getByRole("button", { name: "Register" }));
    expect(await screen.findByText("The code is wrong or has expired.")).toBeInTheDocument();
    expect(screen.getByLabelText("Phone (optional)")).toHaveValue("0899999999");
    expect(screen.getByLabelText("Email")).toHaveValue("line@example.com");
  });

  it("checks the password rule and the confirmation before sending (042-05)", async () => {
    const api = mockApi({ "POST /api/v1/me/registration": () => json(200, USER) });
    openDialog();
    await userEvent.type(await screen.findByLabelText("Verification code"), "123456");
    await userEvent.type(screen.getByLabelText("Password"), "abcdefgh");
    await userEvent.type(screen.getByLabelText("Confirm password"), "abcdefgh");
    await userEvent.click(screen.getByRole("button", { name: "Register" }));
    expect(await screen.findByText("Use 8–64 characters with at least one letter and one digit.")).toBeInTheDocument();
    await userEvent.clear(screen.getByLabelText("Password"));
    await userEvent.type(screen.getByLabelText("Password"), "abcd1234");
    await userEvent.clear(screen.getByLabelText("Confirm password"));
    await userEvent.type(screen.getByLabelText("Confirm password"), "abcd12345");
    await userEvent.click(screen.getByRole("button", { name: "Register" }));
    expect(await screen.findByText("The two passwords don't match.")).toBeInTheDocument();
    expect(screen.getByLabelText("Verification code")).toHaveValue("123456");
    expect(screen.getByLabelText("Password")).toHaveAttribute("type", "password");
    expect(api.count("POST /api/v1/me/registration")).toBe(0);
  });

  it("reopens when a registered-only action is tried (042-04)", async () => {
    openDialog();
    await userEvent.click(await screen.findByRole("button", { name: "Close" }));
    expect(useSession.getState().registerOpen).toBe(false);
    await userEvent.click(screen.getByRole("button", { name: "Create organization" }));
    expect(useSession.getState().registerOpen).toBe(true);
  });

  it("a double tap registers once", async () => {
    let release!: () => void;
    const api = mockApi({
      "POST /api/v1/me/email-code": () => json(204, null),
      "POST /api/v1/me/registration": () =>
        new Promise<Response>((r) => (release = () => r(json(200, USER)))),
      "GET /api/v1/me": () => json(200, USER),
      "GET /api/v1/me/tenants": () => json(200, []),
    });
    openDialog();
    await userEvent.click(await screen.findByRole("button", { name: "Send code" }));
    await userEvent.type(screen.getByLabelText("Verification code"), "123456");
    await userEvent.type(screen.getByLabelText("Password"), "abcd1234");
    await userEvent.type(screen.getByLabelText("Confirm password"), "abcd1234");
    const submit = screen.getByRole("button", { name: "Register" });
    await userEvent.click(submit);
    await userEvent.click(submit);
    release();
    await waitFor(() => expect(useSession.getState().registerOpen).toBe(false));
    expect(api.count("POST /api/v1/me/registration")).toBe(1);
  });
});

describe("profile (FR-SYS-044)", () => {
  it("saves nickname and clears the phone (044-01)", async () => {
    const saved = { ...USER, display_name: "Somchai", phone: null };
    const api = mockApi({
      "PATCH /api/v1/me": () => json(200, saved),
      "GET /api/v1/me": () => json(200, saved),
      "GET /api/v1/me/tenants": () => json(200, []),
    });
    signedIn({ ...USER, display_name: "Old" });
    renderWithProviders(<ProfilePage />);
    const name = await screen.findByLabelText("Nickname");
    await userEvent.clear(name);
    await userEvent.type(name, "Somchai");
    await userEvent.clear(screen.getByLabelText("Phone (optional)"));
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    await waitFor(() => expect(useSession.getState().me?.display_name).toBe("Somchai"));
    expect(useSession.getState().me?.phone).toBeNull();
    expect(await api.bodies("PATCH /api/v1/me")).toEqual([{ display_name: "Somchai", phone: "" }]);
  });

  it("shows a phone error under the phone field (044-03, 055-02)", async () => {
    mockApi({
      "PATCH /api/v1/me": () =>
        json(400, { code: "validation_error", message_key: "x", fields: ["phone"] }),
    });
    signedIn();
    renderWithProviders(<ProfilePage />);
    const phone = await screen.findByLabelText("Phone (optional)");
    await userEvent.clear(phone);
    await userEvent.type(phone, "abc");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));
    expect(await screen.findByText("Enter a valid phone number.")).toBeInTheDocument();
    expect(screen.getByLabelText("Nickname")).toHaveValue("Somchai");
  });

  it("changes the email with a code (044-02)", async () => {
    const changed = { ...USER, email: "new@example.com" };
    mockApi({
      "POST /api/v1/me/email-code": () => json(204, null),
      "POST /api/v1/me/email": () => json(200, changed),
      "GET /api/v1/me": () => json(200, changed),
      "GET /api/v1/me/tenants": () => json(200, []),
    });
    signedIn();
    renderWithProviders(<ProfilePage />);
    await userEvent.click(await screen.findByRole("button", { name: "Change email" }));
    await userEvent.type(screen.getByLabelText("New email"), "new@example.com");
    await userEvent.click(screen.getByRole("button", { name: "Send code" }));
    await userEvent.type(screen.getByLabelText("Verification code"), "654321");
    await userEvent.click(screen.getByRole("button", { name: "Confirm" }));
    await waitFor(() => expect(useSession.getState().me?.email).toBe("new@example.com"));
  });
});
