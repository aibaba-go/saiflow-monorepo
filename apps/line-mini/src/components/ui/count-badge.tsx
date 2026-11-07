import type { ReactNode } from "react";

/** A count on top of an icon (antd-mobile `Badge`): hidden at 0, otherwise the exact number. */
export function CountBadge({ count, children }: { count: number; children: ReactNode }) {
  return (
    <span className="relative inline-flex">
      {children}
      {count > 0 && (
        <span className="absolute -top-1.5 -right-2 min-w-[18px] rounded-pill bg-danger px-1 text-center text-caption font-semibold text-on-primary">
          {String(count)}
        </span>
      )}
    </span>
  );
}
