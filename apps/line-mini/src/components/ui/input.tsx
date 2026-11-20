import { X } from "lucide-react";
import type { InputHTMLAttributes } from "react";

import { cn } from "../../lib/cn";

export interface InputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "value" | "onChange"> {
  value: string;
  onChange(value: string): void;
  /** Show a clear button while there is text (antd-mobile `clearable`). */
  clearable?: boolean;
  /** The clear button's accessible name, in the UI language. */
  clearLabel?: string;
}

/** STD-008 §7.2: 44px high, control radius, primary ring on focus. */
export function Input({ value, onChange, clearable, clearLabel, className, ...props }: InputProps) {
  return (
    <div className={cn("relative flex min-w-0 flex-1 items-center", className)}>
      <input
        {...props}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={cn(
          "min-h-11 w-full min-w-0 rounded-control border border-border bg-surface px-3 text-body text-text",
          "placeholder:text-text-tertiary focus:border-primary focus:ring-3 focus:ring-primary-soft focus:outline-none",
          "disabled:bg-surface-muted aria-invalid:border-danger",
          clearable && value && "pr-11",
        )}
      />
      {clearable && value && (
        <button
          type="button"
          aria-label={clearLabel}
          onClick={() => onChange("")}
          className="absolute right-0 flex size-11 items-center justify-center text-icon"
        >
          <X size={16} strokeWidth={1.75} aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
