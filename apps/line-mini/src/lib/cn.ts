import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// tailwind-merge must know the STD-008 font sizes and radii, or it drops a colour class that
// follows a size class (text-body vs text-primary).
const merge = extendTailwindMerge({
  extend: {
    classGroups: {
      "font-size": [{ text: ["caption", "sm", "base", "body", "title-sm", "title", "display"] }],
      rounded: [{ rounded: ["card", "control", "pill"] }],
    },
  },
});

/** Join class names; later Tailwind classes win over earlier ones (shadcn/ui `cn`). */
export function cn(...inputs: ClassValue[]): string {
  return merge(clsx(inputs));
}
