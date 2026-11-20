
import { useT } from "../../i18n";
import { EmptyState } from "../ui/empty-state";

/** Placeholder until scanning, history and reports exist (FR-SYS-056). */
export function ComingSoon() {
  const t = useT();
  return (
    <EmptyState status="empty" title={t("common.comingSoon")} description={t("common.comingSoonBody")} />
  );
}
