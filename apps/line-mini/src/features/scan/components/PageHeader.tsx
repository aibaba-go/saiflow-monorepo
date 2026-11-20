import type { ReactNode } from "react";

import { useT } from "../../../i18n";
import s from "./PageHeader.module.css";

/** main `PageHeader.vue`: back arrow, title, optional actions on the right. */
export function PageHeader({ title, onBack, children }: {
  title: string;
  onBack(): void;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <header className={s.header}>
      <button type="button" className={s.back} aria-label={t("common.back")} onClick={onBack}>
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <path d="M15 18l-6-6 6-6" />
        </svg>
      </button>
      <h1 className={s.title}>{title}</h1>
      <div className={s.slot}>{children}</div>
    </header>
  );
}
