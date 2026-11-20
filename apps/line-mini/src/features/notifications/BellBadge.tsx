import { useNavigate } from "react-router-dom";

import { useT } from "../../i18n";
import { useSession } from "../../stores/session";
import { useUnreadCount } from "./data";
import { Button } from "../../components/ui/button";
import { CountBadge } from "../../components/ui/count-badge";

/** The notification entry with the unread count (FR-SYS-054); not shown to guests. */
export function BellBadge() {
  const t = useT();
  const navigate = useNavigate();
  const isUser = useSession((s) => s.me?.kind === "user");
  const unread = useUnreadCount();
  if (!isUser) return null;
  const n = unread.data ?? 0;
  return (
    <CountBadge count={n}>
      <Button
        size="sm"
        aria-label={n > 0 ? t("notif.bellUnread", { n }) : t("notif.bell")}
        onClick={() => navigate("/notifications")}
      >
        🔔
      </Button>
    </CountBadge>
  );
}
