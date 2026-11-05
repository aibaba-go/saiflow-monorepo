import { Button } from "antd-mobile";
import { useState } from "react";

import { BrandLoading } from "../../components/BrandLoading";
import { ErrorText } from "../../components/ErrorText";
import { useSubmit } from "../../hooks/useSubmit";
import { useT } from "../../i18n";
import { useSession } from "../../stores/session";
import { formatBangkokDateTime } from "../../utils/format";
import { useMarkRead, useNotificationPages } from "./data";
import { renderNotification, type NotificationItem } from "./render";

/** The notification center (FR-SYS-054): newest first, read or unread, never deleted. */
export function NotificationsPage() {
  const t = useT();
  const tenants = useSession((s) => s.tenants);
  const pages = useNotificationPages();
  const markRead = useMarkRead();
  const [error, setError] = useState<unknown>(null);
  const all = useSubmit(async () => {
    try {
      await markRead();
    } catch (err) {
      setError(err);
    }
  });

  const tenantName = (id: number) => {
    const tenant = tenants.find((x) => x.tenant_id === id);
    return tenant?.kind === "organization" ? (tenant.name ?? "") : t("tenant.personal");
  };
  const open = async (n: NotificationItem) => {
    if (n.read) return;
    try {
      await markRead([n.id]);
    } catch (err) {
      setError(err);
    }
  };

  if (pages.isPending) return <BrandLoading label={t("common.loading")} />;
  if (pages.isError) return <ErrorText error={pages.error} />;
  const items = pages.data.pages.flatMap((p) => p.items);
  const unread = pages.data.pages[0]?.unread_count ?? 0;

  return (
    <div className="page">
      <h1 className="page__title">{t("notif.title")}</h1>
      {unread > 0 && (
        <Button size="small" loading={all.pending} onClick={() => void all.run()}>
          {t("notif.markAll")}
        </Button>
      )}
      <ErrorText error={error} />
      {items.length === 0 && <div className="card-row__meta">{t("notif.empty")}</div>}
      {items.map((n) => {
        const { title, body } = renderNotification(n, t, tenantName(n.tenant_id));
        return (
          <button
            key={n.id}
            type="button"
            className={`card-row notif ${n.read ? "notif--read" : "notif--unread"}`}
            aria-label={n.read ? undefined : t("notif.unreadItem", { title })}
            onClick={() => void open(n)}
          >
            <span className="card-row__title">{title}</span>
            <span className="card-row__meta">{body}</span>
            <span className="card-row__meta">{formatBangkokDateTime(n.created_at)}</span>
          </button>
        );
      })}
      {pages.hasNextPage && (
        <Button loading={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
          {t("notif.loadMore")}
        </Button>
      )}
    </div>
  );
}
