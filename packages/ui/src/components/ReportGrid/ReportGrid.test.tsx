import { fireEvent, render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { ReportGrid } from "./ReportGrid";
import { clampLayout, stackOrder, type GridCard } from "./stackOrder";

type Card = GridCard & { title: string };
const c = (id: string, x: number, y: number, w = 6, h = 4): Card => ({ id, title: `Card ${id}`, layout: { x, y, w, h } });

describe("stackOrder", () => {
  it("orders by y, then x, then id without changing the input", () => {
    const cards = [c("d", 6, 4), c("b", 0, 4), c("z", 6, 0), c("a", 0, 0), c("c2", 3, 4), c("c1", 3, 4)];
    const before = cards.map((x) => x.id);
    expect(stackOrder(cards).map((x) => x.id)).toEqual(["a", "z", "b", "c1", "c2", "d"]);
    expect(cards.map((x) => x.id)).toEqual(before);
  });

  it("compares ids by code unit, not locale", () => {
    expect(stackOrder([c("b", 0, 0), c("B", 0, 0), c("a", 0, 0)]).map((x) => x.id)).toEqual(["B", "a", "b"]);
  });

  it("clamps layouts into the 12-column grid", () => {
    expect(clampLayout({ x: 11, y: -1, w: 4, h: 20 })).toEqual({ x: 8, y: 0, w: 4, h: 12 });
    expect(clampLayout({ x: -2, y: 3, w: 0, h: 1 })).toEqual({ x: 0, y: 3, w: 1, h: 2 });
  });
});

describe("ReportGrid", () => {
  const cards = [c("second", 6, 0), c("third", 0, 4), c("first", 0, 0)];
  const renderCard = (card: Card) => <p>{card.title}</p>;

  it("stack mode renders one column in stack order", () => {
    render(<ReportGrid cards={cards} renderCard={renderCard} mode="stack" stackItemHeight={() => 240} />);
    const list = screen.getByRole("list", { name: "Report" });
    const items = within(list).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual(["Card first", "Card second", "Card third"]);
    expect(items[0]!.querySelector(".sf-rg-stack__body")).toHaveStyle({ height: "240px" });
  });

  it("design mode marks the selected card and selects with the keyboard", async () => {
    const onSelect = vi.fn();
    const onLayoutChange = vi.fn();
    render(
      <ReportGrid
        cards={cards}
        renderCard={renderCard}
        mode="design"
        selectedId="second"
        onSelect={onSelect}
        onLayoutChange={onLayoutChange}
      />,
    );
    const second = await screen.findByRole("button", { name: "Card second" });
    expect(second).toHaveAttribute("aria-pressed", "true");
    expect(second).toHaveClass("is-selected");
    const first = screen.getByRole("button", { name: "Card first" });
    expect(first).toHaveAttribute("aria-pressed", "false");

    first.focus();
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledWith("first");

    onLayoutChange.mockClear();
    fireEvent.keyDown(second, { key: "ArrowRight", shiftKey: true });
    expect(onLayoutChange).toHaveBeenCalledWith({
      // Wider than the space left: kept inside the 12 columns.
      second: { x: 5, y: 0, w: 7, h: 4 },
      third: { x: 0, y: 4, w: 6, h: 4 },
      first: { x: 0, y: 0, w: 6, h: 4 },
    });
    fireEvent.keyDown(first, { key: "ArrowDown" });
    expect(onLayoutChange).toHaveBeenLastCalledWith(expect.objectContaining({ first: { x: 0, y: 1, w: 6, h: 4 } }));
  });

  it("view mode renders static, non-interactive cards", async () => {
    render(<ReportGrid cards={cards} renderCard={renderCard} mode="view" />);
    expect(await screen.findByText("Card first")).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getAllByRole("listitem")).toHaveLength(3);
  });
});
