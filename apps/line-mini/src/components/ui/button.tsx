import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "../../lib/cn";

// STD-008 §7.1. Labels wrap instead of being cut (FR-SYS-136); the height is a minimum so a
// two-line Thai label grows the button. Small buttons keep a 44px tap area (FR-SYS-134).
const buttonVariants = cva(
  [
    "relative inline-flex items-center justify-center gap-1.5 whitespace-normal text-center font-semibold",
    "rounded-control border border-transparent transition-colors duration-150 ease-out motion-reduce:transition-none",
    "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary",
    "disabled:cursor-not-allowed disabled:opacity-45",
  ],
  {
    variants: {
      variant: {
        primary: "bg-primary text-on-primary hover:bg-primary-hover active:bg-primary-pressed",
        secondary: "bg-primary-soft text-primary-pressed",
        outline: "border-border bg-surface text-text",
        ghost: "bg-transparent text-primary-pressed",
        danger: "bg-danger text-on-primary",
      },
      size: {
        md: "min-h-11 px-4 py-2 text-body",
        sm: "min-h-9 px-3 py-1 text-sm before:absolute before:inset-x-0 before:top-1/2 before:min-h-11 before:-translate-y-1/2 before:content-['']",
      },
      block: { true: "w-full", false: "" },
    },
    defaultVariants: { variant: "outline", size: "md", block: false },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
  asChild?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { className, variant, size, block, loading = false, asChild = false, disabled, children, type = "button", ...props },
  ref,
) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      ref={ref}
      type={asChild ? undefined : type}
      className={cn(buttonVariants({ variant, size, block }), className)}
      disabled={disabled || loading}
      aria-busy={loading ? true : undefined}
      {...props}
    >
      {loading && (
        <span
          aria-hidden="true"
          className="size-4 shrink-0 animate-spin rounded-full border-2 border-current border-t-transparent motion-reduce:animate-none"
        />
      )}
      {children}
    </Comp>
  );
});
