import { lazy, Suspense, useId, useMemo, type ComponentType, type ReactNode, type CSSProperties } from "react";
import type { ReportAppearance } from "../reportTypes";

import { CardFrame, DEFAULT_REPORT_GRID_LABELS, type ReportGridLabels } from "./CardFrame";
import type { GridCanvasProps } from "./GridCanvas";
import { GRID_COLS, stackOrder, type GridCard, type LayoutsById } from "./stackOrder";
import "../components.css";

// react-grid-layout is only loaded for the PC grid; LINE (stack mode) never downloads it.
const GridCanvas = lazy(() => import("./GridCanvas")) as unknown as ComponentType<GridCanvasProps<GridCard>>;

export interface ReportGridProps<C extends GridCard> {
  cards: readonly C[];
  renderCard: (card: C) => ReactNode;
  /** design: drag/resize/select (PC designer); view: same grid, static; stack: one column (LINE). */
  mode: "design" | "view" | "stack";
  /** Grid columns; default 12. */
  cols?: number;
  /** Row height in px (config grid.row_height); default 80. */
  rowHeight?: number;
  /** [horizontal, vertical] gap in px; default [12, 12]. */
  margin?: readonly [number, number];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  /** Design mode: new layouts of all cards by card id, only when something changed. */
  onLayoutChange?: (layouts: LayoutsById) => void;
  /** Stack mode height of a card body in px; default clamp(h × 56, 200, 420). */
  stackItemHeight?: (card: C) => number | undefined;
  labels?: Partial<ReportGridLabels>;
  /** Shown while the grid code loads. */
  fallback?: ReactNode;
  appearance?: ReportAppearance | null;
}

const defaultStackHeight = (card: GridCard) => Math.min(420, Math.max(200, card.layout.h * 56));

/** Report card layout for PC (12-column grid) and LINE (single column by y, x, id) — FR-REPORT-018. */
export function ReportGrid<C extends GridCard>({
  cards,
  renderCard,
  mode,
  cols = GRID_COLS,
  rowHeight = 80,
  margin = [12, 12],
  selectedId,
  onSelect,
  onLayoutChange,
  stackItemHeight,
  labels: labelsIn,
  fallback = null,
  appearance,
}: ReportGridProps<C>) {
  const style = appearance ? { background: appearance.background ?? "#F4F7FB", padding: 12, borderRadius: 12, "--sf-report-radius": `${appearance.radius ?? 12}px`, "--sf-report-shadow": appearance.shadow ? "0 4px 18px #24385816" : "none" } as CSSProperties : undefined;
  const labels = useMemo(() => ({ ...DEFAULT_REPORT_GRID_LABELS, ...labelsIn }), [labelsIn]);
  const helpId = useId();
  const ordered = useMemo(() => (mode === "stack" ? stackOrder(cards) : []), [cards, mode]);

  if (mode === "stack") {
    return (
      <ul className="sf-rg-stack sf-report-appearance" aria-label={labels.grid} style={{ ...style, gap: appearance?.gap }}>
        {ordered.map((c) => {
          const height = stackItemHeight?.(c) ?? defaultStackHeight(c);
          return (
            <li key={c.id}>
              <CardFrame card={c} mode="stack" selected={false} labels={labels} cols={cols}>
                <div className="sf-rg-stack__body" style={{ height }}>
                  {renderCard(c)}
                </div>
              </CardFrame>
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div className="sf-report-appearance" style={style}>
      {mode === "design" && (
        <p id={helpId} className="sf-visually-hidden">
          {labels.designHelp}
        </p>
      )}
      <Suspense fallback={fallback}>
        <GridCanvas
          cards={cards}
          renderCard={renderCard as (card: GridCard) => ReactNode}
          mode={mode}
          cols={cols}
          rowHeight={rowHeight}
          margin={appearance?.gap ? [appearance.gap, appearance.gap] : margin}
          selectedId={selectedId}
          onSelect={onSelect}
          onLayoutChange={onLayoutChange}
          labels={labels}
          helpId={mode === "design" ? helpId : undefined}
        />
      </Suspense>
    </div>
  );
}
