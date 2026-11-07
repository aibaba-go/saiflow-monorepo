import { Button, Popup } from "antd-mobile";
import { useState } from "react";

import { BrandLoading } from "../../components/BrandLoading";
import { ErrorText } from "../../components/ErrorText";
import { Field } from "../../components/Field";
import { formLevel, requireFields } from "../../components/FieldError";
import { useT } from "../../i18n";
import { api, call } from "../../services/api";
import type { CurrentTenant } from "../../stores/session";
import { useSubmit } from "../../hooks/useSubmit";
import { confirmAction } from "../../utils/confirm";
import { can, PERMISSIONS, type Permission } from "../tenants/permissions";
import { useCurrentTenant } from "../tenants/useCurrentTenant";
import { orgPath, useMembers, useRefreshOrg, useRoles, type Role } from "./orgData";
import { permissionKey } from "./permissionLabels";

function RoleForm({ orgId, role, onDone }: { orgId: number; role: Role | null; onDone(): void }) {
  const t = useT();
  const refresh = useRefreshOrg(orgId);
  const [name, setName] = useState(role?.name ?? "");
  const [chosen, setChosen] = useState<Set<string>>(new Set(role?.permissions ?? []));
  const [error, setError] = useState<unknown>(null);
  const toggle = (p: Permission) =>
    setChosen((prev) => {
      const next = new Set(prev);
      if (next.has(p)) next.delete(p);
      else next.add(p);
      return next;
    });
  const save = useSubmit(async () => {
    const missing = requireFields({ name });
    setError(missing);
    if (missing) return;
    const body = { name, permissions: [...chosen] };
    try {
      if (role) {
        await call(
          api.PATCH("/api/v1/organizations/{tenant_id}/roles/{role_id}", {
            params: { path: { tenant_id: orgId, role_id: role.id } },
            body,
          }),
        );
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
    <div className="form">
      <Field id="role-name" label={t("roles.name")} value={name} onChange={setName} error={error} field="name" />
      <fieldset className="checks">
        <legend className="field__label">{t("roles.permissions")}</legend>
        {PERMISSIONS.map((p) => (
          <label key={p} className="checks__item">
            <input type="checkbox" checked={chosen.has(p)} onChange={() => toggle(p)} />
            {t(permissionKey(p))}
          </label>
        ))}
      </fieldset>
      <ErrorText error={formLevel(error)} />
      <Button color="primary" loading={save.pending} onClick={() => void save.run()}>
        {t("common.save")}
      </Button>
    </div>
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
  const ownRole = tenant.is_owner ? null : (tenant.role?.id ?? null);
  const manage = can(tenant, "role_manage");

  const remove = async (role: Role) => {
    const users = (members.data ?? []).filter((m) => m.role?.id === role.id).length;
    const content =
      users === 0
        ? undefined
        : users === 1
          ? t("roles.deleteMovesOne")
          : t("roles.deleteMovesMany", { n: users });
    if (!(await confirmAction(t, t("roles.deleteTitle", { name: role.name }), content))) return;
    try {
      await call(
        api.DELETE("/api/v1/organizations/{tenant_id}/roles/{role_id}", {
          params: { path: { tenant_id: orgId, role_id: role.id } },
        }),
      );
      await refresh();
    } catch (err) {
      setError(err);
    }
  };
  const removeOnce = useSubmit(remove); // one request per tap (minor-fixes-ui)
  if (roles.isPending) return <BrandLoading label={t("common.loading")} />;
  if (roles.isError) return <ErrorText error={roles.error} />;

  return (
    <div className="page">
      <h1 className="page__title">{t("roles.title")}</h1>
      <ErrorText error={error} />
      {roles.data.map((role) => (
        <div key={role.id} className="card-row" data-role={role.id}>
          <div className="card-row__title">
            {role.name}
            {role.is_default && ` · ${t("roles.default")}`}
          </div>
          <div className="card-row__meta">{role.permissions.map((p) => t(permissionKey(p))).join(", ")}</div>
          {manage && role.id !== ownRole && (
            <div className="card-row__actions">
              <Button size="mini" onClick={() => setEditing(role)}>
                {t("common.edit")}
              </Button>
              {!role.is_default && (
                <Button size="mini" color="danger" onClick={() => void removeOnce.run(role)}>
                  {t("common.delete")}
                </Button>
              )}
            </div>
          )}
        </div>
      ))}
      {manage && (
        <Button color="primary" onClick={() => setEditing("new")}>
          {t("roles.new")}
        </Button>
      )}
      <Popup visible={editing !== null} onMaskClick={() => setEditing(null)} bodyStyle={{ padding: 16 }}>
        {editing !== null && (
          <RoleForm orgId={orgId} role={editing === "new" ? null : editing} onDone={() => setEditing(null)} />
        )}
      </Popup>
    </div>
  );
}

/** Roles and their permission points (FR-SYS-049). */
export function RolesPage() {
  const t = useT();
  const { tenant } = useCurrentTenant();
  if (!tenant || tenant.kind !== "organization") return <div className="page">{t("org.none")}</div>;
  return <RolesContent key={tenant.tenant_id} tenant={tenant} />;
}
