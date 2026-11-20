import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

export type TagTone = "primary" | "success" | "warning" | "review" | "danger" | "default";

const TONES: Record<TagTone, string> = {
  primary: "bg-info-bg text-info-text",
  success: "bg-success-bg text-success-text",
  warning: "bg-warning-bg text-warning-text",
  review: "bg-review-bg text-review-text",
  danger: "bg-danger-bg text-danger-text",
  default: "bg-surface-muted text-text-secondary",
};

/** A status pill: soft background and readable text, never colour alone (STD-008 §7.3). */
export function Tag({
  tone = "default",
  children,
  className,
}: {
  tone?: TagTone;
  children: ReactNode;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-pill px-2.5 py-0.5 text-sm font-medium whitespace-nowrap",
        TONES[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}
