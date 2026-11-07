import { confirmDialog } from "../components/ui/dialogs";
import type { T } from "../i18n";

/** A yes/no question before a change that is hard to undo (remove, revoke, leave, transfer). */
export function confirmAction(t: T, title: string, content?: string): Promise<boolean> {
  return confirmDialog({
    title,
    content,
    confirmText: t("common.confirm"),
    cancelText: t("common.cancel"),
  });
}
