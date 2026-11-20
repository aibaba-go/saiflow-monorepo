import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

const TONES = {
  info: "bg-info-bg text-info-text",
  warning: "bg-warning-bg text-warning-text",
  danger: "bg-danger-bg text-danger-text",
} as const;

/** An inline notice bar (antd-mobile `NoticeBar`). */
export function Alert({
  tone = "info",
  children,
  className,
}: {
  tone?: keyof typeof TONES;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div role="note" className={cn("rounded-control px-3.5 py-2.5 text-sm", TONES[tone], className)}>
      {children}
    </div>
  );
}
