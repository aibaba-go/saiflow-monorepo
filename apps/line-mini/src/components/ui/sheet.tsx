import * as DialogPrimitive from "@radix-ui/react-dialog";
import type { ReactNode } from "react";

import { cn } from "../../lib/cn";

/** A panel that slides up from the bottom (antd-mobile `Popup`). Tap outside or Esc closes it. */
export function BottomSheet({
  open,
  onClose,
  label,
  children,
  className,
}: {
  open: boolean;
  onClose(): void;
  /** The panel's accessible name. Given to an empty title through aria-label, so it never
   * repeats a heading the panel already shows (and tests finding that text see one match). */
  label: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={(next) => !next && onClose()}>
      <DialogPrimitive.Portal>
        {/* Portaled apart from the panel and possibly appended after it: the panel's higher
            z-index keeps it above the mask. */}
        <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-overlay" />
        <DialogPrimitive.Content
          aria-describedby={undefined}
          className={cn(
            "fixed inset-x-0 bottom-0 z-[41] max-h-[85vh] overflow-y-auto rounded-t-card bg-surface p-3 pb-[max(12px,env(safe-area-inset-bottom))] shadow-pop",
            "focus:outline-none",
            className,
          )}
        >
          <DialogPrimitive.Title className="sr-only" aria-label={label} />
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}
