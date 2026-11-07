import { CircleAlert, CircleCheck, FileSearch, Hourglass, Inbox } from "lucide-react";
import type { ReactNode } from "react";

const ICONS = {
  empty: Inbox,
  error: CircleAlert,
  notFound: FileSearch,
  success: CircleCheck,
  waiting: Hourglass,
};
const COLORS = {
  empty: "text-icon",
  error: "text-danger",
  notFound: "text-icon",
  success: "text-success",
  waiting: "text-warning",
};

/** Empty, error and result pages (antd-mobile `ErrorBlock` / `Result`, STD-008 §7.8). */
export function EmptyState({
  status = "empty",
  title,
  description,
  children,
}: {
  status?: keyof typeof ICONS;
  title: ReactNode;
  description?: ReactNode;
  children?: ReactNode;
}) {
  const Icon = ICONS[status];
  return (
    <div className="flex flex-col items-center gap-2.5 px-4 py-8 text-center">
      <Icon size={40} strokeWidth={1.75} className={COLORS[status]} aria-hidden="true" />
      <p className="m-0 text-title-sm font-semibold text-text">{title}</p>
      {description && <p className="m-0 text-body text-text-secondary">{description}</p>}
      {children}
    </div>
  );
}
