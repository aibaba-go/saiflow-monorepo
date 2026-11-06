import { Button, Checkbox, Form, Input, Modal, Space, Spin, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";

import { ConfirmButton } from "../components/ConfirmButton";
import { ErrorText } from "../components/ErrorText";
import { formLevel, requireFields } from "../components/FieldError";
import { Page } from "../components/Page";
import { useSubmit } from "../hooks/useSubmit";
import { useT } from "../i18n";
import { fieldProps } from "../orgs/form";
import { orgPath, useMembers, useRefreshOrg, useRoles, type Role } from "../orgs/orgData";
import { permissionKey } from "../orgs/permissionLabels";
import { api, call } from "../services/api";
import { can, PERMISSIONS } from "../tenants/permissions";
import type { CurrentTenant } from "../tenants/useCurrentTenant";
import { useTenant } from "../tenants/useTenant";

function RoleForm({ orgId, role, onDone }: { orgId: number; role: Role | null; onDone(): void }) {
  const t = useT();
  const refresh = useRefreshOrg(orgId);
  const [name, setName] = useState(role?.name ?? "");
  const [chosen, setChosen] = useState<string[]>(role?.permissions ?? []);
  const [error, setError] = useState<unknown>(null);
  const item = fieldProps(error, t);
  const save = useSubmit(async () => {
    const missing = requireFields({ name });
    setError(missing);
    if (missing) return;
    // Keep the catalog order (FR-SYS-002), whatever order they were ticked in.
    const body = { name, permissions: PERMISSIONS.filter((p) => chosen.includes(p)) };
    try {
      if (role) {
        await call(api.PATCH("/api/v1/organizations/{tenant_id}/roles/{role_id}", { params: { path: { tenant_id: orgId, role_id: role.id } }, body }));
      } else {
        await call(api.POST("/api/v1/organizations/{tenant_id}/roles", { ...orgPath(orgId), body }));
      }
      await refresh();
      onDone();
    } catch (err) {
      setError(err);
    }
  });
  return (
    <Form layout="vertical">
      <Form.Item label={t("roles.name")} htmlFor="role-name" {...item("name")}>
        <Input id="role-name" value={name} onChange={(e) => setName(e.target.value)} />
      </Form.Item>
      <Form.Item label={t("roles.permissions")} {...item("permissions")}>
        <Checkbox.Group
          value={chosen}
          onChange={(values) => setChosen(values as string[])}
          options={PERMISSIONS.map((p) => ({ value: p, label: t(permissionKey(p)) }))}
          style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}
        />
      </Form.Item>
      <ErrorText error={formLevel(error)} />
      <Button type="primary" loading={save.pending} onClick={() => void save.run()} style={{ marginTop: 8 }}>
        {t("common.save")}
      </Button>
    </Form>
  );
}

function RolesContent({ tenant }: { tenant: CurrentTenant }) {
  const t = useT();
  const orgId = tenant.tenant_id;
  const roles = useRoles(orgId);
  const members = useMembers(orgId);
  const refresh = useRefreshOrg(orgId);
  const [editing, setEditing] = useState<Role | "new" | null>(null);
  const [error, setError] = useState<unknown>(null);
  if (roles.isPending) return <Spin />;
  if (roles.isError) return <ErrorText error={roles.error} />;
  // Never the owner's role or the editor's own current role (FR-SYS-099, 049).
  const ownRole = tenant.is_owner ? null : (tenant.role?.id ?? null);
  const manage = can(tenant, "role_manage");

  const moves = (role: Role) => {
    const users = (members.data ?? []).filter((m) => m.role?.id === role.id).length;
    if (users === 0) return undefined;
    return users === 1 ? t("roles.deleteMovesOne") : t("roles.deleteMovesMany", { n: users });
  };
  const remove = async (role: Role) => {
    setError(null);
    try {
      await call(api.DELETE("/api/v1/organizations/{tenant_id}/roles/{role_id}", { params: { path: { tenant_id: orgId, role_id: role.id } } }));
      await refresh();
    } catch (err) {
      setError(err);
    }
  };

  const columns: ColumnsType<Role> = [
    { title: t("roles.name"), key: "name", render: (_, r) => (r.is_default ? `${r.name} · ${t("roles.default")}` : r.name) },
    { title: t("roles.permissions"), key: "perms", render: (_, r) => r.permissions.map((p) => t(permissionKey(p))).join(", ") },
  ];
  if (manage) {
    columns.push({
      title: t("common.actions"),
      key: "actions",
      render: (_, r) =>
        r.id === ownRole ? null : (
          <Space>
            <Button size="small" onClick={() => setEditing(r)}>
              {t("common.edit")}
            </Button>
            {!r.is_default && (
              <ConfirmButton
                size="small"
                danger
                label={t("common.delete")}
                title={t("roles.deleteTitle", { name: r.name })}
                description={moves(r)}
                onConfirm={() => remove(r)}
              />
            )}
          </Space>
        ),
    });
  }

  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <ErrorText error={error} />
      {manage && (
        <Button type="primary" onClick={() => setEditing("new")}>
          {t("roles.new")}
        </Button>
      )}
      <Table<Role> data-testid="roles" rowKey="id" columns={columns} dataSource={roles.data} pagination={false} />
      <Modal
        open={editing !== null}
        title={editing === "new" ? t("roles.new") : t("common.edit")}
        footer={null}
        onCancel={() => setEditing(null)}
        destroyOnHidden
      >
        {editing !== null && <RoleForm orgId={orgId} role={editing === "new" ? null : editing} onDone={() => setEditing(null)} />}
      </Modal>
    </Space>
  );
}

/** Roles and their permission points (FR-SYS-099). OrgGate guarantees an organization. */
export function RolesPage() {
  const t = useT();
  const { tenant } = useTenant();
  if (!tenant || tenant.kind !== "organization") return null;
  return (
    <Page name="roles" title={t("roles.title")}>
      <RolesContent key={tenant.tenant_id} tenant={tenant} />
    </Page>
  );
}
