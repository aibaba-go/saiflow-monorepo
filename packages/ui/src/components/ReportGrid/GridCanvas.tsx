import { useMemo, type ReactNode, type RefObject } from "react";
import ReactGridLayout, { useContainerWidth, type Layout } from "react-grid-layout";
import "react-grid-layout/css/styles.css";

import { CardFrame, type ReportGridLabels } from "./CardFrame";
import { clampLayout, sameLayout, type GridCard, type LayoutsById } from "./stackOrder";

export interface GridCanvasProps<C extends GridCard> {
  cards: readonly C[];
  renderCard: (card: C) => ReactNode;
  mode: "design" | "view";
  cols: number;
  rowHeight: number;
  margin: readonly [number, number];
  selectedId?: string | null;
  onSelect?: (id: string) => void;
  onLayoutChange?: (layouts: LayoutsById) => void;
  labels: ReportGridLabels;
  helpId?: string;
}

/** The react-grid-layout canvas (design: drag/resize; view: the same grid, static). */
export default function GridCanvas<C extends GridCard>({
  cards,
  renderCard,
  mode,
  cols,
  rowHeight,
  margin,
  selectedId,
  onSelect,
  onLayoutChange,
  labels,
  helpId,
}: GridCanvasProps<C>) {
  const { width, containerRef, mounted } = useContainerWidth({ initialWidth: 1200 });
  const design = mode === "design";
  const layout = useMemo<Layout>(
    () =>
      cards.map((c) => ({
        i: c.id,
        ...clampLayout(c.layout, cols),
        minW: 1,
        maxW: cols,
        minH: 2,
        maxH: 12,
        static: !design,
      })),
    [cards, cols, design],
  );

  const emit = (next: LayoutsById) => {
    if (!onLayoutChange) return;
    const changed = cards.some((c) => !sameLayout(c.layout, next[c.id]));
    if (changed) onLayoutChange(next);
  };

  const handleLayoutChange = (next: Layout) => {
    if (!design) return;
    const map: LayoutsById = {};
    for (const c of cards) map[c.id] = c.layout;
    for (const it of next) map[it.i] = { x: it.x, y: it.y, w: it.w, h: it.h };
    emit(map);
  };

  const handleKeyboard = (id: string, l: LayoutsById[string]) => {
    const map: LayoutsById = {};
    for (const c of cards) map[c.id] = c.id === id ? l : c.layout;
    emit(map);
  };

  return (
    <div ref={containerRef as RefObject<HTMLDivElement>} className={`sf-rg sf-rg--${mode}`} role="list" aria-label={labels.grid}>
      {mounted && (
        <ReactGridLayout
          width={width}
          layout={layout}
          gridConfig={{ cols, rowHeight, margin, containerPadding: [0, 0] }}
          dragConfig={{ enabled: design, cancel: ".sf-rg-nodrag, button, input, select, textarea, a" }}
          resizeConfig={{ enabled: design, handles: ["se"] }}
          onLayoutChange={handleLayoutChange}
        >
          {cards.map((c) => (
            <div key={c.id} role="listitem">
              <CardFrame
                card={c}
                mode={mode}
                selected={selectedId === c.id}
                labels={labels}
                helpId={helpId}
                cols={cols}
                onSelect={onSelect}
                onKeyboardLayout={design ? handleKeyboard : undefined}
              >
                {renderCard(c)}
              </CardFrame>
            </div>
          ))}
        </ReactGridLayout>
      )}
    </div>
  );
}
