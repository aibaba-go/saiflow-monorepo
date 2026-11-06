import { useQuery } from "@tanstack/react-query";
import { Badge, Button } from "antd";
import { useNavigate } from "react-router-dom";

import { useT } from "../i18n";
import { api, call } from "../services/api";

export const UNREAD_KEY = ["notifications", "unread"] as const;

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
  return (
    <Badge count={count} data-testid="unread-badge">
      <Button onClick={() => navigate("/notifications")}>{t("nav.notifications")}</Button>
    </Badge>
  );
}
