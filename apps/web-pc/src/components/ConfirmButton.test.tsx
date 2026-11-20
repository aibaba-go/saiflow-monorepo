import { render, screen, waitFor } from "@testing-library/react";
import userEventLib from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConfirmButton } from "./ConfirmButton";

const userEvent = userEventLib.setup({ pointerEventsCheck: 0 });

describe("ConfirmButton (AC-FR-SYS-104-02)", () => {
  it("asks first and runs once even when OK is clicked twice", async () => {
    let release!: () => void;
    const action = vi.fn(() => new Promise<void>((r) => (release = r)));
    render(<ConfirmButton label="Remove" title="Remove this member?" onConfirm={action} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove" }));
    expect(action).not.toHaveBeenCalled();
    const ok = await screen.findByRole("button", { name: "Confirm" });
    await userEvent.dblClick(ok);
    await userEvent.click(screen.getByRole("button", { name: /Remove/ }));
    const again = screen.queryAllByRole("button", { name: "Confirm" });
    if (again.length) await userEvent.click(again[again.length - 1]!);
    release();
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  });
});
