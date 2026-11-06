import { useQueryClient } from "@tanstack/react-query";
import { Button, Card, Descriptions, Form, Input, Select, Space, Tag, Typography } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { ConfirmButton } from "../components/ConfirmButton";
import { ErrorText } from "../components/ErrorText";
import { formLevel, requireFields } from "../components/FieldError";
import { useSubmit } from "../hooks/useSubmit";
import { useT, type MessageKey } from "../i18n";
import { api, call } from "../services/api";
import { can } from "../tenants/permissions";
import { refreshTenants, type CurrentTenant } from "../tenants/useCurrentTenant";
import { useTenant } from "../tenants/useTenant";
import { fieldProps } from "./form";
import { orgPath, useRefreshOrg, useVerification, type Member, type OrgView } from "./orgData";

const VERIFICATION: Record<string, MessageKey> = {
  none: "verify.none",
  pending: "app.pending",
  verified: "verify.verified",
  rejected: "app.rejected",
};

/** Name, phone, address and verification status; editable with member management (FR-SYS-098). */
export function ProfileCard({ org, tenant }: { org: OrgView; tenant: CurrentTenant }) {
  const t = useT();
  const queryClient = useQueryClient();
  const refresh = useRefreshOrg(org.tenant_id);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(org.name);
  const [phone, setPhone] = useState(org.contact_phone);
  const [address, setAddress] = useState(org.address ?? "");
  const [error, setError] = useState<unknown>(null);
  const item = fieldProps(error, t);
  const save = useSubmit(async () => {
    const missing = requireFields({ name, contact_phone: phone });
    setError(missing);
    if (missing) return;
    try {
      await call(api.PATCH("/api/v1/organizations/{tenant_id}", { ...orgPath(org.tenant_id), body: { name, contact_phone: phone, address } }));
      await refresh();
      await refreshTenants(queryClient);
      setEditing(false);
    } catch (err) {
      setError(err);
    }
  });
  const editable = can(tenant, "member_manage");
  return (
    <Card
      title={t("org.profile")}
      extra={editable && !editing ? <Button onClick={() => setEditing(true)}>{t("common.edit")}</Button> : null}
    >
      {editing ? (
        <Form layout="vertical" style={{ maxWidth: 480 }}>
          <Form.Item label={t("org.name")} htmlFor="org-edit-name" {...item("name")}>
            <Input id="org-edit-name" value={name} onChange={(e) => setName(e.target.value)} />
          </Form.Item>
          <Form.Item label={t("org.phone")} htmlFor="org-edit-phone" {...item("contact_phone")}>
            <Input id="org-edit-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
          </Form.Item>
          <Form.Item label={t("org.addressOptional")} htmlFor="org-edit-address" {...item("address")}>
            <Input id="org-edit-address" value={address} onChange={(e) => setAddress(e.target.value)} />
          </Form.Item>
          <ErrorText error={formLevel(error)} />
          <Space style={{ marginTop: 8 }}>
            <Button type="primary" loading={save.pending} onClick={() => void save.run()}>
              {t("common.save")}
            </Button>
            <Button onClick={() => setEditing(false)}>{t("common.cancel")}</Button>
          </Space>
        </Form>
      ) : (
        <Descriptions column={1} data-testid="org-profile">
          <Descriptions.Item label={t("org.name")}>{org.name}</Descriptions.Item>
          <Descriptions.Item label={t("org.phone")}>{org.contact_phone}</Descriptions.Item>
          <Descriptions.Item label={t("org.addressOptional")}>{org.address ?? t("common.notSet")}</Descriptions.Item>
          <Descriptions.Item label={t("org.verification")}>{t(VERIFICATION[org.verification_status]!)}</Descriptions.Item>
        </Descriptions>
      )}
    </Card>
  );
}

/** Enterprise verification: status, reason, and the form when it may be (re)submitted (FR-SYS-101). */
export function VerificationCard({ tenant }: { tenant: CurrentTenant }) {
  const t = useT();
  const orgId = tenant.tenant_id;
  const verification = useVerification(orgId);
  const refresh = useRefreshOrg(orgId);
  const [legal, setLegal] = useState("");
  const [tax, setTax] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<unknown>(null);
  const item = fieldProps(error, t);
  const submit = useSubmit(async () => {
    const missing = requireFields({ legal_name: legal, tax_id: tax, registered_address: address });
    setError(missing);
    if (missing) return;
    try {
      await call(
        api.POST("/api/v1/organizations/{tenant_id}/verification", {
          ...orgPath(orgId),
          body: { legal_name: legal, tax_id: tax, registered_address: address },
        }),
      );
      await refresh();
    } catch (err) {
      setError(err);
    }
  });
  const data = verification.data;
  const open = data && (data.status === "none" || data.status === "rejected") && can(tenant, "verification_apply");
  return (
    <Card title={t("org.verification")} data-testid="verification">
      <ErrorText error={verification.error} />
      {data && (
        <Space direction="vertical" style={{ width: "100%" }}>
          <Space>
            <Typography.Text>{t("verify.status")}:</Typography.Text>
            <Tag color={data.status === "rejected" ? "red" : data.status === "verified" ? "green" : "blue"}>
              {t(VERIFICATION[data.status]!)}
            </Tag>
          </Space>
          {data.reject_reason && <Typography.Text>{t("app.reason", { reason: data.reject_reason })}</Typography.Text>}
          {open && (
            <Form layout="vertical" style={{ maxWidth: 480 }}>
              <Form.Item label={t("verify.legalName")} htmlFor="ver-legal" {...item("legal_name")}>
                <Input id="ver-legal" value={legal} onChange={(e) => setLegal(e.target.value)} />
              </Form.Item>
              <Form.Item label={t("verify.taxId")} htmlFor="ver-tax" {...item("tax_id")}>
                <Input id="ver-tax" value={tax} onChange={(e) => setTax(e.target.value)} />
              </Form.Item>
              <Form.Item label={t("verify.address")} htmlFor="ver-address" {...item("registered_address")}>
                <Input id="ver-address" value={address} onChange={(e) => setAddress(e.target.value)} />
              </Form.Item>
              <ErrorText error={formLevel(error)} />
              <Button type="primary" loading={submit.pending} onClick={() => void submit.run()}>
                {t("common.submit")}
              </Button>
            </Form>
          )}
        </Space>
      )}
    </Card>
  );
}

/** Transfer the owner (owner only), or leave (members only) (FR-SYS-100). */
export function OwnerActions({ org, tenant, members, selfId }: { org: OrgView; tenant: CurrentTenant; members: Member[]; selfId: number | null }) {
  const t = useT();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { setTenant } = useTenant();
  const refresh = useRefreshOrg(org.tenant_id);
  const [target, setTarget] = useState<number | null>(null);
  const [error, setError] = useState<unknown>(null);
  const others = members.filter((m) => m.user_id !== selfId);
  const targetName = others.find((m) => m.user_id === target)?.display_name ?? "";

  const transfer = async () => {
    setError(null);
    try {
      await call(api.POST("/api/v1/organizations/{tenant_id}/owner-transfer", { ...orgPath(org.tenant_id), body: { user_id: target! } }));
      setTarget(null);
      await refreshTenants(queryClient);
      await refresh();
    } catch (err) {
      setError(err);
    }
  };
  const leave = async () => {
    setError(null);
    try {
      await call(api.POST("/api/v1/organizations/{tenant_id}/leave", orgPath(org.tenant_id)));
      setTenant(null);
      await refreshTenants(queryClient);
      navigate("/");
    } catch (err) {
      setError(err);
    }
  };

  return (
    <Card>
      <ErrorText error={error} />
      {tenant.is_owner ? (
        <Space>
          <Select<number>
            aria-label={t("owner.pick")}
            placeholder={t("owner.pick")}
            value={target ?? undefined}
            onChange={setTarget}
            style={{ minWidth: 200 }}
            options={others.map((m) => ({ value: m.user_id, label: m.display_name ?? "" }))}
          />
          <ConfirmButton
            label={t("owner.transfer")}
            title={t("owner.transferTitle", { name: targetName })}
            disabled={target === null}
            onConfirm={transfer}
          />
        </Space>
      ) : (
        <ConfirmButton danger label={t("org.leave")} title={t("org.leaveTitle", { name: org.name })} onConfirm={leave} />
      )}
    </Card>
  );
}
