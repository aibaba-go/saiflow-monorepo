import type { ReactNode } from "react";
import { createPortal } from "react-dom";

import theme from "../theme.module.css";
import fd from "./FormDialog.module.css";

/** main `FormDialog.vue`: a centred card over a dim mask. Its `fd-*` classes (buttons,
 * fields) are exported for the dialog's content, as in main. */
export function FormDialog({ title, subtitle, children }: { title: string; subtitle?: string; children: ReactNode }) {
  return createPortal(
    <div className={`${theme.tokens} ${fd["fd-mask"]}`} role="dialog" aria-modal="true" aria-label={title}>
      <div className={fd["fd-card"]}>
        <div className={fd["fd-title"]}>{title}</div>
        {subtitle && <p className={fd["fd-subtitle"]}>{subtitle}</p>}
        {children}
      </div>
    </div>,
    document.body,
  );
}

export { fd };
