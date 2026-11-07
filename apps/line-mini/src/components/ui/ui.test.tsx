import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";

import { Button } from "./button";
import { CountBadge } from "./count-badge";
import { alertDialog, confirmDialog, DialogHost } from "./dialogs";
import { EmptyState } from "./empty-state";
import { Input } from "./input";
import { ListGroup, ListItem } from "./list";
import { BottomSheet } from "./sheet";
import { Tag } from "./tag";
import { AppToaster, showToast } from "./toast";

describe("Button", () => {
  it("loading keeps the label and blocks clicks", async () => {
    const onClick = vi.fn();
    render(
      <Button loading onClick={onClick}>
        Save
      </Button>,
    );
    const b = screen.getByRole("button", { name: /Save/ });
    expect(b).toBeDisabled();
    expect(b).toHaveAttribute("aria-busy", "true");
    await userEvent.click(b);
    expect(onClick).not.toHaveBeenCalled();
  });

  it("wraps long labels (Review Focus 1, FR-SYS-136)", () => {
    render(<Button>ยืนยันการส่งเอกสารทั้งหมดเพื่อตรวจสอบ</Button>);
    const b = screen.getByRole("button");
    expect(b.className).not.toMatch(/whitespace-nowrap|truncate|(^|\s)h-\d/);
    expect(b.className).toMatch(/min-h-11/);
  });

  it("small buttons still have a 44px tap area (FR-SYS-134)", () => {
    render(<Button size="sm">Edit</Button>);
    expect(screen.getByRole("button").className).toMatch(/before:min-h-11|before:-inset/);
  });
});

describe("dialogs", () => {
  it("confirm resolves true / false", async () => {
    render(<DialogHost />);
    const p = confirmDialog({ title: "Remove?", confirmText: "Confirm", cancelText: "Cancel" });
    await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    await expect(p).resolves.toBe(true);
    const q = confirmDialog({ title: "Remove?", confirmText: "Confirm", cancelText: "Cancel" });
    await userEvent.click(await screen.findByRole("button", { name: "Cancel" }));
    await expect(q).resolves.toBe(false);
  });

  it("confirm resolves once (Review Focus 3)", async () => {
    render(<DialogHost />);
    const seen: boolean[] = [];
    void confirmDialog({ title: "T", confirmText: "Confirm", cancelText: "Cancel" }).then((v) => seen.push(v));
    const btn = await screen.findByRole("button", { name: "Confirm" });
    await userEvent.dblClick(btn);
    await waitFor(() => expect(seen).toEqual([true]));
    await new Promise((r) => setTimeout(r, 20));
    expect(seen).toEqual([true]);
  });

  it("alert resolves on OK", async () => {
    render(<DialogHost />);
    const p = alertDialog({ content: "Received", confirmText: "OK" });
    expect(await screen.findByText("Received")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "OK" }));
    await expect(p).resolves.toBeUndefined();
  });

  it("confirm over an open sheet (Review Focus 2)", async () => {
    function Page() {
      const [open, setOpen] = useState(true);
      const [done, setDone] = useState(false);
      return (
        <>
          <BottomSheet open={open} onClose={() => setOpen(false)} label="Choose">
            <button
              onClick={async () => {
                if (await confirmDialog({ title: "Transfer?", confirmText: "Confirm", cancelText: "Cancel" })) {
                  setOpen(false);
                  setDone(true);
                }
              }}
            >
              Alice
            </button>
          </BottomSheet>
          {done && <p>transferred</p>}
          <DialogHost />
        </>
      );
    }
    render(<Page />);
    await userEvent.click(screen.getByRole("button", { name: "Alice" }));
    await userEvent.click(await screen.findByRole("button", { name: "Confirm" }));
    expect(await screen.findByText("transferred")).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });
});

describe("BottomSheet", () => {
  it("closes on Escape and restores pointer events (Review Focus 5)", async () => {
    function Page() {
      const [open, setOpen] = useState(true);
      return (
        <BottomSheet open={open} onClose={() => setOpen(false)} label="Languages">
          <p>body</p>
        </BottomSheet>
      );
    }
    render(<Page />);
    expect(screen.getByRole("dialog", { name: "Languages" })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(screen.queryByText("body")).not.toBeInTheDocument());
    await waitFor(() => expect(document.body.style.pointerEvents).not.toBe("none"));
  });
});

describe("small parts", () => {
  it("toast shows text", async () => {
    render(<AppToaster />);
    act(() => showToast("Copied"));
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("input clear button empties the value", async () => {
    const onChange = vi.fn();
    render(<Input id="n" value="abc" onChange={onChange} clearable clearLabel="Clear" />);
    await userEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("input passes typed text", async () => {
    function Box() {
      const [v, setV] = useState("");
      return <Input id="n" aria-label="Name" value={v} onChange={setV} />;
    }
    render(<Box />);
    await userEvent.type(screen.getByRole("textbox", { name: "Name" }), "Siam");
    expect(screen.getByRole("textbox", { name: "Name" })).toHaveValue("Siam");
  });

  it("count badge caps at 99+", () => {
    render(
      <CountBadge count={120}>
        <span>bell</span>
      </CountBadge>,
    );
    expect(screen.getByText("99+")).toBeInTheDocument();
  });

  it("count badge hides zero", () => {
    render(
      <CountBadge count={0}>
        <span>bell</span>
      </CountBadge>,
    );
    expect(screen.queryByText("0")).not.toBeInTheDocument();
  });

  it("tag tone class", () => {
    render(<Tag tone="review">x</Tag>);
    expect(screen.getByText("x").className).toMatch(/bg-review-bg/);
  });

  it("list item with onClick is a button", async () => {
    const onClick = vi.fn();
    render(
      <ListGroup>
        <ListItem onClick={onClick}>Plans</ListItem>
        <ListItem description="hint">Guest</ListItem>
      </ListGroup>,
    );
    await userEvent.click(screen.getByRole("button", { name: /Plans/ }));
    expect(onClick).toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /Guest/ })).not.toBeInTheDocument();
    expect(screen.getByText("hint")).toBeInTheDocument();
  });

  it("empty state shows title and actions", () => {
    render(
      <EmptyState status="error" title="Not found" description="Gone">
        <button>Back</button>
      </EmptyState>,
    );
    expect(screen.getByText("Not found")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Back" })).toBeInTheDocument();
  });
});
