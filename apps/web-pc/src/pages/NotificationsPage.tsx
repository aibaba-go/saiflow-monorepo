import { Badge, Button, List, Space, Spin, Typography } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { ErrorText } from "../components/ErrorText";
import { Page } from "../components/Page";
import { formatBangkokDateTime } from "../format";
import { useSubmit } from "../hooks/useSubmit";
import { useT } from "../i18n";
import { useMarkRead, useNotificationPages } from "../notifications/data";
import { renderNotification, type NotificationItem } from "../notifications/render";
import { useTenantChoice } from "../tenants/useCurrentTenant";

/** The notification center (FR-SYS-103): newest first, read or unread, never deleted. */
export function NotificationsPage() {
  const t = useT();
  const tenants = useTenantChoice((s) => s.tenants) ?? [];
  const pages = useNotificationPages();
  const markRead = useMarkRead();
  const [error, setError] = useState<unknown>(null);
  const [handled, setHandled] = useState(false);
  const all = useSubmit(async () => {
    setError(null);
    try {
      await markRead();
    } catch (err) {
      setError(err);
    }
  });

  const tenantName = (id: number) => {
    const tenant = tenants.find((x) => x.tenant_id === id);
    if (!tenant) return t("tenant.left"); // an organization the user has left
    return tenant.kind === "organization" ? (tenant.name ?? "") : t("tenant.personal");
  };
  const navigate = useNavigate();
  const choose = useTenantChoice((s) => s.choose);
  const current = useTenantChoice((s) => s.id);
  const open = async (n: NotificationItem) => {
    if (!n.read) {
      try {
        await markRead([n.id]);
      } catch (err) {
        setError(err);
        return;
      }
    }
    // a review notice opens the review detail in its organization (FR-SYS-103)
    const jobId = (n.data as Record<string, unknown>).job_id;
    if (n.type === "review_pending" && typeof jobId === "string") {
      if (!tenants.some((x) => x.tenant_id === n.tenant_id)) {
        setHandled(true); // no longer a member: nothing to review there
        return;
      }
      if (current !== n.tenant_id) choose(n.tenant_id);
      navigate(`/reviews/${jobId}`);
    }
  };

  const body = () => {
    if (pages.isPending) return <Spin />;
    if (pages.isError) return <ErrorText error={pages.error} />;
    const items = pages.data.pages.flatMap((p) => p.items);
    const unread = pages.data.pages[0]?.unread_count ?? 0;
    return (
      <Space direction="vertical" size="middle" style={{ width: "100%", maxWidth: 800 }}>
        {unread > 0 && (
          <Button loading={all.pending} onClick={() => void all.run()}>
            {t("notif.markAll")}
          </Button>
        )}
        <ErrorText error={error} />
        {handled && <Typography.Text type="warning">{t("review.handled")}</Typography.Text>}
        <List<NotificationItem>
          bordered
          locale={{ emptyText: t("notif.empty") }}
          dataSource={items}
          renderItem={(n) => {
            const { title, body: text } = renderNotification(n, t, tenantName(n.tenant_id));
            return (
              <List.Item
                style={{
                  cursor: n.read && n.type !== "review_pending" ? "default" : "pointer",
                  background: n.read ? undefined : "var(--brand-blue-soft)",
                }}
                role={n.read && n.type !== "review_pending" ? undefined : "button"}
                aria-label={n.read ? undefined : t("notif.unreadItem", { title })}
                onClick={() => void open(n)}
              >
                <Space direction="vertical" size={0}>
                  <Space>
                    {!n.read && <Badge status="processing" />}
                    <Typography.Text strong={!n.read}>{title}</Typography.Text>
                  </Space>
                  <Typography.Text>{text}</Typography.Text>
                  <Typography.Text type="secondary">{formatBangkokDateTime(n.created_at)}</Typography.Text>
                </Space>
              </List.Item>
            );
          }}
        />
        {pages.hasNextPage && (
          <Button loading={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>
            {t("notif.loadMore")}
          </Button>
        )}
      </Space>
    );
  };

  return (
    <Page name="notifications" title={t("notif.title")}>
      {body()}
    </Page>
  );
}
