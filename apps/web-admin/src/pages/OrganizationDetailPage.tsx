import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Card, Descriptions, Form, Input, Result, Space, Spin } from "antd";
import { useState } from "react";
import { Link, useParams } from "react-router-dom";

import { ConfirmButton } from "../components/ConfirmButton";
import { ErrorText } from "../components/ErrorText";
import { fieldErrorText, formLevel, requireFields } from "../components/FieldError";
import { Page } from "../components/Page";
import { OrgStatusTag, VerificationTag } from "../components/Tags";
import { formatTime } from "../format";
import { useSubmit } from "../hooks/useSubmit";
import { useT } from "../i18n";
import { idParam, orgKeys, organizations, type Organization } from "../services/organizations";

/** Organization detail: profile, disable/enable, verification, billing link (FR-SYS-064). */
export function OrganizationDetailPage() {
  const t = useT();
  const id = idParam(useParams().id);
  if (id === null) return <Result status="404" title={t("common.notFound")} />;
  return <Detail id={id} />;
}

function Detail({ id }: { id: number }) {
  const t = useT();
  const queryClient = useQueryClient();
  const org = useQuery({ queryKey: orgKeys.one(id), queryFn: () => organizations.get(id) });
  const [error, setError] = useState<unknown>(null);

  async function act(action: () => Promise<unknown>) {
    setError(null);
    try {
      await action();
    } catch (e) {
      setError(e);
    } finally {
      await queryClient.invalidateQueries({ queryKey: orgKeys.all });
    }
  }

  if (org.isPending) return <Spin style={{ display: "block", marginTop: 80 }} />;
  if (org.isError) return <ErrorText error={org.error} />;
  const o = org.data;

  return (
    <Page
      name="organization"
      title={o.name}
      extra={<Link to={`/tenants/${o.tenant_id}/billing?kind=organization`}>{t("org.billing")}</Link>}
    >
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        <ErrorText error={error} />
        <Card>
          <Descriptions data-testid="org-facts" column={{ xs: 1, md: 2 }}>
            <Descriptions.Item label={t("col.status")}>
              <OrgStatusTag status={o.status} />
            </Descriptions.Item>
            <Descriptions.Item label={t("col.verification")}>
              <VerificationTag status={o.verification_status} />
            </Descriptions.Item>
            <Descriptions.Item label={t("col.members")}>{o.member_count}</Descriptions.Item>
            <Descriptions.Item label={t("col.foundedAt")}>{formatTime(o.created_at)}</Descriptions.Item>
          </Descriptions>
          <Space wrap>
            {o.status === "active" ? (
              <ConfirmButton
                danger
                key="org.disable"
                label={t("org.disable")}
                title={t("org.confirmDisable")}
                onConfirm={() => act(() => organizations.setStatus(id, "disabled"))}
              />
            ) : (
              <ConfirmButton
                key="org.enable"
                label={t("org.enable")}
                title={t("org.confirmEnable")}
                onConfirm={() => act(() => organizations.setStatus(id, "active"))}
              />
            )}
            {o.verification_status === "verified" ? (
              <ConfirmButton
                key="org.unsetVerified"
                label={t("org.unsetVerified")}
                title={t("org.confirmUnsetVerified")}
                onConfirm={() => act(() => organizations.setVerified(id, false))}
              />
            ) : (
              <ConfirmButton
                key="org.setVerified"
                label={t("org.setVerified")}
                title={t("org.confirmSetVerified")}
                onConfirm={() => act(() => organizations.setVerified(id, true))}
              />
            )}
          </Space>
        </Card>
        {/* a fresh form whenever the saved profile changes */}
        <ProfileForm key={JSON.stringify([o.name, o.contact_phone, o.address])} org={o} />
      </Space>
    </Page>
  );
}

function ProfileForm({ org }: { org: Organization }) {
  const t = useT();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [name, setName] = useState(org.name);
  const [phone, setPhone] = useState(org.contact_phone);
  const [address, setAddress] = useState(org.address ?? "");
  const [error, setError] = useState<unknown>(null);

  const { run, pending } = useSubmit(async () => {
    setError(null);
    try {
      const saved = await organizations.update(org.tenant_id, { name, contact_phone: phone, address });
      queryClient.setQueryData(orgKeys.one(org.tenant_id), saved);
      await queryClient.invalidateQueries({ queryKey: orgKeys.all, exact: true });
      void message.success(t("org.saved"));
    } catch (e) {
      setError(e);
    }
  });

  function save() {
    const missing = requireFields({ name, contact_phone: phone });
    if (missing) setError(missing);
    else void run();
  }

  const item = (field: string) => {
    const text = fieldErrorText(error, field, t);
    return { validateStatus: text ? ("error" as const) : undefined, help: text };
  };

  return (
    <Card title={t("org.profile")}>
      <Form layout="vertical" onFinish={save} style={{ maxWidth: 480 }}>
        <Form.Item label={t("col.name")} htmlFor="org-name" {...item("name")}>
          <Input id="org-name" maxLength={100} value={name} onChange={(e) => setName(e.target.value)} />
        </Form.Item>
        <Form.Item label={t("col.phone")} htmlFor="org-phone" {...item("contact_phone")}>
          <Input id="org-phone" maxLength={32} value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Form.Item>
        <Form.Item label={t("col.address")} htmlFor="org-address" {...item("address")}>
          <Input.TextArea id="org-address" rows={2} maxLength={300} value={address} onChange={(e) => setAddress(e.target.value)} />
        </Form.Item>
        <Space direction="vertical" style={{ width: "100%" }}>
          <ErrorText error={formLevel(error)} />
          <Button type="primary" htmlType="submit" loading={pending}>
            {t("common.save")}
          </Button>
        </Space>
      </Form>
    </Card>
  );
}
