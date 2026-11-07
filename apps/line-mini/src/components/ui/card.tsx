import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

/** A white card with the mini app radius (STD-008 §7.4). */
export function Card({
  title,
  extra,
  children,
  className,
}: {
  title?: ReactNode;
  extra?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <section className={cn("flex flex-col gap-3 rounded-card bg-surface p-4 shadow-card", className)}>
      {(title || extra) && (
        <div className="flex items-center justify-between gap-2">
          {title && <h2 className="m-0 text-title-sm font-semibold text-text">{title}</h2>}
          {extra}
        </div>
      )}
      {children}
    </section>
  );
}
