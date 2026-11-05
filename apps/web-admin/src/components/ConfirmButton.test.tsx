import { render, screen, waitFor } from "@testing-library/react";
import userEventLib from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { ConfirmButton } from "./ConfirmButton";

const userEvent = userEventLib.setup({ pointerEventsCheck: 0 });

describe("ConfirmButton (AC-FR-SYS-073-01)", () => {
  it("asks first and runs once even on a double click", async () => {
    let release!: () => void;
    const action = vi.fn(() => new Promise<void>((r) => (release = r)));
    render(<ConfirmButton label="停用" title="确定停用？" onConfirm={action} />);
    await userEvent.click(screen.getByRole("button", { name: "停用" }));
    expect(action).not.toHaveBeenCalled();
    const ok = await screen.findByRole("button", { name: "确定" });
    await userEvent.click(ok);
    await userEvent.click(screen.getByRole("button", { name: /停用/ }));
    const again = screen.queryAllByRole("button", { name: "确定" });
    if (again.length) await userEvent.click(again[again.length - 1]!);
    release();
    await waitFor(() => expect(action).toHaveBeenCalledTimes(1));
  });
});
