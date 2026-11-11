import type { CardLayout } from "../reportTypes";

/** Minimal card shape the grid needs: a stable id and a 12-column layout. */
export interface GridCard {
  id: string;
  layout: CardLayout;
}

function compareId(a: string, b: string): number {
  // Code-unit order (not locale), so PC and LINE order the same everywhere.
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * LINE single-column order (FR-REPORT-018): by PC row y, then column x, then stable card id.
 * Returns a new array; the input is not changed.
 */
export function stackOrder<C extends GridCard>(cards: readonly C[]): C[] {
  return [...cards].sort((a, b) => a.layout.y - b.layout.y || a.layout.x - b.layout.x || compareId(a.id, b.id));
}

/** Layouts by card id. */
export type LayoutsById = Record<string, CardLayout>;

export const GRID_COLS = 12;
export const MIN_CARD_H = 2;
export const MAX_CARD_H = 12;

/** Keep a layout inside the 12-column grid limits of the report config (0≤x, x+w≤12, 1≤w, 2≤h≤12). */
export function clampLayout(l: CardLayout, cols = GRID_COLS): CardLayout {
  const w = Math.min(cols, Math.max(1, Math.round(l.w)));
  const x = Math.min(cols - w, Math.max(0, Math.round(l.x)));
  const h = Math.min(MAX_CARD_H, Math.max(MIN_CARD_H, Math.round(l.h)));
  const y = Math.max(0, Math.round(l.y));
  return { x, y, w, h };
}

export function sameLayout(a: CardLayout | undefined, b: CardLayout | undefined): boolean {
  return !!a && !!b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h;
}
