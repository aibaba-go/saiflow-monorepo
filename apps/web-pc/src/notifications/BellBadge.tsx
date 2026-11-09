import { useQuery } from "@tanstack/react-query";
import { Badge, Button } from "antd";
import { useNavigate } from "react-router-dom";

import { useT } from "../i18n";
import { Icon } from "../layout/icons";
import { api, call } from "../services/api";
import { notificationKeys } from "./data";


export const UNREAD_KEY = notificationKeys.unread;

/** The unread count in the header, hidden at 0 (FR-SYS-103). */
export function BellBadge() {
  const t = useT();
  const navigate = useNavigate();
  const unread = useQuery({
    queryKey: UNREAD_KEY,
    queryFn: async () =>
      (await call(api.GET("/api/v1/me/notifications", { params: { query: { limit: "1" } } }))).unread_count,
  });
  const count = unread.data ?? 0;
  // The prototype's bell: an icon button whose name stays "Notifications"; the badge keeps the
  // real unread count (FR-SYS-103).
  return (
    <Badge count={count} size="small" offset={[-4, 4]} data-testid="unread-badge" className="pc-bell">
      <Button
        type="text"
        className="pc-bell__button"
        aria-label={t("nav.notifications")}
        icon={<Icon name="bell" />}
        onClick={() => navigate("/notifications")}
      />
    </Badge>
  );
}
