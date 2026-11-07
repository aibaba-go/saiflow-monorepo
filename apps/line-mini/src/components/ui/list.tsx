import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

/** A card of rows (antd-mobile `List`). */
export function ListGroup({
  header,
  children,
  className,
}: {
  header?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-col", className)}>
      {header && <div className="px-1 pb-1.5 text-sm text-text-secondary">{header}</div>}
      <div className="divide-y divide-border overflow-hidden rounded-card bg-surface shadow-card">{children}</div>
    </div>
  );
}

/** One row; with `onClick` it is a button with an arrow (antd-mobile `List.Item`). */
export function ListItem({
  onClick,
  description,
  extra,
  children,
}: {
  onClick?(): void;
  description?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
}) {
  const body = (
    <>
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="text-body text-text">{children}</span>
        {description && <span className="text-sm text-text-secondary">{description}</span>}
      </span>
      {extra}
      {onClick && <ChevronRight size={18} strokeWidth={1.75} className="shrink-0 text-icon" aria-hidden="true" />}
    </>
  );
  const row = "flex min-h-12 w-full items-center gap-3 px-4 py-3 text-left";
  return onClick ? (
    <button type="button" onClick={onClick} className={cn(row, "bg-surface active:bg-surface-muted")}>
      {body}
    </button>
  ) : (
    <div className={row}>{body}</div>
  );
}
