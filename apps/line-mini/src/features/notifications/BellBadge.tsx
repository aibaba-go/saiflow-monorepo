import { Badge, Button } from "antd-mobile";
import { useNavigate } from "react-router-dom";

import { useT } from "../../i18n";
import { useSession } from "../../stores/session";
import { useUnreadCount } from "./data";

/** The notification entry with the unread count (FR-SYS-054); not shown to guests. */
export function BellBadge() {
  const t = useT();
  const navigate = useNavigate();
  const isUser = useSession((s) => s.me?.kind === "user");
  const unread = useUnreadCount();
  if (!isUser) return null;
  const n = unread.data ?? 0;
  return (
    <Badge content={n > 0 ? String(n) : null}>
      <Button
        size="small"
        aria-label={n > 0 ? t("notif.bellUnread", { n }) : t("notif.bell")}
        onClick={() => navigate("/notifications")}
      >
        🔔
      </Button>
    </Badge>
  );
}
