import type { KeyboardEvent, ReactNode } from "react";

import { clampLayout, type GridCard, type LayoutsById } from "./stackOrder";

export interface ReportGridLabels {
  /** Accessible name of the whole grid. */
  grid: string;
  /** Accessible name of one card in design mode (default: its title or id). */
  card: (card: GridCard & { title?: string | null }) => string;
  /** Keyboard help for design mode (screen readers). */
  designHelp: string;
}

export const DEFAULT_REPORT_GRID_LABELS: ReportGridLabels = {
  grid: "Report",
  card: (card) => card.title?.trim() || card.id,
  designHelp:
    "Press Enter to select a card. Arrow keys move the selected card; Shift and arrow keys resize it.",
};

export interface CardFrameProps<C extends GridCard> {
  card: C;
  mode: "design" | "view" | "stack";
  selected: boolean;
  labels: ReportGridLabels;
  helpId?: string;
  cols: number;
  children: ReactNode;
  onSelect?: (id: string) => void;
  /** Design mode keyboard move/resize: the new layout of this card. */
  onKeyboardLayout?: (id: string, layout: LayoutsById[string]) => void;
}

/** Wrapper of one card: in design mode a selectable, keyboard-operable frame. */
export function CardFrame<C extends GridCard>({
  card,
  mode,
  selected,
  labels,
  helpId,
  cols,
  children,
  onSelect,
  onKeyboardLayout,
}: CardFrameProps<C>) {
  if (mode !== "design") {
    return (
      <div className="sf-rg-card" data-card-id={card.id}>
        {children}
      </div>
    );
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget) return;
    if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      onSelect?.(card.id);
      return;
    }
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [-1, 0],
      ArrowRight: [1, 0],
      ArrowUp: [0, -1],
      ArrowDown: [0, 1],
    };
    const delta = moves[e.key];
    if (!delta || !onKeyboardLayout) return;
    e.preventDefault();
    const [dx, dy] = delta;
    const l = card.layout;
    const next = e.shiftKey
      ? clampLayout({ ...l, w: l.w + dx, h: l.h + dy }, cols)
      : clampLayout({ ...l, x: l.x + dx, y: l.y + dy }, cols);
    if (!selected) onSelect?.(card.id);
    onKeyboardLayout(card.id, next);
  };
  return (
    <div
      className={`sf-rg-card${selected ? " is-selected" : ""}`}
      data-card-id={card.id}
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={labels.card(card)}
      aria-describedby={helpId}
      onClick={() => onSelect?.(card.id)}
      onKeyDown={onKeyDown}
    >
      {children}
    </div>
  );
}
