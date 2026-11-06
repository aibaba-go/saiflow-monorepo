import { Card, Select, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";

import { ConfirmButton } from "../components/ConfirmButton";
import { ErrorText } from "../components/ErrorText";
import { formatBangkokDate } from "../format";
import { useT } from "../i18n";
import { api, call } from "../services/api";
import { can } from "../tenants/permissions";
import type { CurrentTenant } from "../tenants/useCurrentTenant";
import { useRefreshOrg, useRoles, type Member } from "./orgData";

/** The members with their role; remove and change role by permission (FR-SYS-098). */
export function MembersCard({
  orgId,
  members,
  tenant,
  selfId,
  seats,
}: {
  orgId: number;
  members: Member[];
  tenant: CurrentTenant;
  selfId: number | null;
  seats: string;
}) {
  const t = useT();
  const refresh = useRefreshOrg(orgId);
  const canRole = can(tenant, "role_manage");
  const canManage = can(tenant, "member_manage");
  const roles = useRoles(orgId, canRole);
  const [error, setError] = useState<unknown>(null);
  const userPath = (userId: number) => ({ params: { path: { tenant_id: orgId, user_id: userId } } });

  const run = async (action: () => Promise<unknown>) => {
    setError(null);
    try {
      await action();
      await refresh();
    } catch (err) {
      setError(err);
    }
  };
  const actionable = (m: Member) => !m.is_owner && m.user_id !== selfId;

  const columns: ColumnsType<Member> = [
    { title: t("member.name"), key: "name", render: (_, m) => m.display_name },
    {
      title: t("member.role"),
      key: "role",
      render: (_, m) => {
        if (m.is_owner) return <Tag color="gold">{t("member.owner")}</Tag>;
        if (!canRole || !actionable(m)) return m.role?.name;
        return (
          <Select
            size="small"
            aria-label={t("member.changeRole")}
            value={m.role?.id}
            style={{ minWidth: 160 }}
            options={(roles.data ?? []).map((r) => ({ value: r.id, label: r.name }))}
            onChange={(roleId: number) =>
              void run(() =>
                call(api.PUT("/api/v1/organizations/{tenant_id}/members/{user_id}/role", { ...userPath(m.user_id), body: { role_id: roleId } })),
              )
            }
          />
        );
      },
    },
    { title: t("member.joinedAt"), key: "joined", render: (_, m) => formatBangkokDate(m.joined_at) },
  ];
  if (canManage) {
    columns.push({
      title: t("common.actions"),
      key: "actions",
      render: (_, m) =>
        actionable(m) ? (
          <ConfirmButton
            size="small"
            danger
            label={t("member.remove")}
            title={t("member.removeTitle", { name: m.display_name ?? "" })}
            onConfirm={() => run(() => call(api.DELETE("/api/v1/organizations/{tenant_id}/members/{user_id}", userPath(m.user_id))))}
          />
        ) : null,
    });
  }

  return (
    <Card title={t("org.members")} extra={<Space>{seats}</Space>}>
      <ErrorText error={error} />
      <Table<Member> data-testid="members" rowKey="user_id" columns={columns} dataSource={members} pagination={false} />
    </Card>
  );
}
