import { Button, Card, List, Modal, QRCode, Space, Typography } from "antd";
import { useState } from "react";

import { ConfirmButton } from "../components/ConfirmButton";
import { ErrorText } from "../components/ErrorText";
import { liffId } from "../config";
import { formatBangkokDate } from "../format";
import { useSubmit } from "../hooks/useSubmit";
import { useT } from "../i18n";
import { api, call } from "../services/api";
import { orgPath, useInvitations, useRefreshOrg, type OrgView } from "./orgData";

export function inviteUrl(token: string): string {
  return `https://liff.line.me/${liffId}?invite=${encodeURIComponent(token)}`;
}

/** The new invitation's link, a Copy button and a QR code; the person opens it in LINE (D4).
 * The link is shown only once, so it stays visible when copying fails (Review Focus 5). */
function InviteDialog({ link, onClose }: { link: string; onClose(): void }) {
  const t = useT();
  const [copied, setCopied] = useState<"ok" | "failed" | null>(null);
  const copy = async () => {
    try {
      if (!navigator.clipboard) throw new Error("no clipboard");
      await navigator.clipboard.writeText(link);
      setCopied("ok");
    } catch {
      setCopied("failed");
    }
  };
  return (
    <Modal
      open
      title={t("invite.dialogTitle")}
      onCancel={onClose}
      footer={<Button onClick={onClose}>{t("common.close")}</Button>}
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Typography.Text type="secondary">{t("invite.linkHint")}</Typography.Text>
        <Typography.Paragraph style={{ userSelect: "all", wordBreak: "break-all", marginBottom: 0 }}>
          {link}
        </Typography.Paragraph>
        <Space>
          <Button type="primary" onClick={() => void copy()}>
            {t("invite.copy")}
          </Button>
          {copied === "ok" && <Typography.Text type="success">{t("invite.copied")}</Typography.Text>}
          {copied === "failed" && <Typography.Text type="warning">{t("invite.copyFailed")}</Typography.Text>}
        </Space>
        <Space direction="vertical" align="center" style={{ width: "100%" }}>
          <Typography.Text type="secondary">{t("invite.scan")}</Typography.Text>
          <div data-testid="invite-qr">
            <QRCode type="svg" value={link} />
          </div>
        </Space>
      </Space>
    </Modal>
  );
}

/** Invite members and the pending invitations (FR-SYS-098); only with member management. */
export function InviteSection({ org }: { org: OrgView }) {
  const t = useT();
  const refresh = useRefreshOrg(org.tenant_id);
  const invitations = useInvitations(org.tenant_id, true);
  const [error, setError] = useState<unknown>(null);
  const [link, setLink] = useState<string | null>(null);
  const full = org.member_limit !== null && org.seats_used >= org.member_limit;

  const invite = useSubmit(async () => {
    setError(null);
    try {
      const created = await call(api.POST("/api/v1/organizations/{tenant_id}/invitations", orgPath(org.tenant_id)));
      setLink(inviteUrl(created.token));
      await refresh();
    } catch (err) {
      setError(err);
    }
  });

  const revoke = async (id: number) => {
    setError(null);
    try {
      await call(
        api.DELETE("/api/v1/organizations/{tenant_id}/invitations/{invitation_id}", {
          params: { path: { tenant_id: org.tenant_id, invitation_id: id } },
        }),
      );
      await refresh();
    } catch (err) {
      setError(err);
    }
  };

  return (
    <Card
      title={t("invite.pending")}
      extra={
        <Space>
          {full && <Typography.Text type="warning">{t("err.member_limit_reached")}</Typography.Text>}
          <Button type="primary" disabled={full} loading={invite.pending} onClick={() => void invite.run()}>
            {t("org.invite")}
          </Button>
        </Space>
      }
    >
      <ErrorText error={error ?? invitations.error} />
      <List
        data-testid="invitations"
        locale={{ emptyText: t("invite.none") }}
        dataSource={invitations.data ?? []}
        renderItem={(inv) => (
          <List.Item
            actions={[
              <ConfirmButton
                key="revoke"
                size="small"
                label={t("invite.revoke")}
                title={t("invite.revokeTitle")}
                onConfirm={() => revoke(inv.id)}
              />,
            ]}
          >
            {t("invite.expires", { date: formatBangkokDate(inv.expires_at) })}
          </List.Item>
        )}
      />
      {link && <InviteDialog link={link} onClose={() => setLink(null)} />}
    </Card>
  );
}
