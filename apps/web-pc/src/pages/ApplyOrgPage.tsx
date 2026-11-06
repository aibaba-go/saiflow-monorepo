import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Form, Input, List, Space, Tag, Typography } from "antd";
import { useState } from "react";

import { ErrorText } from "../components/ErrorText";
import { formLevel, requireFields } from "../components/FieldError";
import { Page } from "../components/Page";
import { formatBangkokDateTime } from "../format";
import { useSubmit } from "../hooks/useSubmit";
import { useT, type MessageKey } from "../i18n";
import { fieldProps } from "../orgs/form";
import type { OrgApplication } from "../orgs/orgData";
import { api, call } from "../services/api";

const STATUS: Record<string, MessageKey> = { pending: "app.pending", approved: "app.approved", rejected: "app.rejected" };
const APPS_KEY = ["my-org-applications"] as const;

/** Apply to create an organization and follow the applications (FR-SYS-097). */
export function ApplyOrgPage() {
  const t = useT();
  const client = useQueryClient();
  const apps = useQuery({ queryKey: APPS_KEY, queryFn: () => call(api.GET("/api/v1/me/organization-applications")) });
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [address, setAddress] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [submitted, setSubmitted] = useState(false);
  const item = fieldProps(error, t);

  const submit = useSubmit(async () => {
    const missing = requireFields({ name, contact_phone: phone });
    setError(missing);
    if (missing) return;
    try {
      await call(api.POST("/api/v1/organization-applications", { body: { name, contact_phone: phone, address } }));
      setSubmitted(true);
      await client.invalidateQueries({ queryKey: APPS_KEY });
    } catch (err) {
      setError(err);
    }
  });

  const pending = apps.data?.some((a) => a.status === "pending");
  return (
    <Page name="apply" title={t("org.applyTitle")}>
      <Space direction="vertical" size="large" style={{ width: "100%", maxWidth: 640 }}>
        {submitted && <Alert type="success" showIcon message={t("org.submitted")} />}
        <ErrorText error={apps.error} />
        {apps.data && apps.data.length > 0 && (
          <Card title={t("org.myApplications")}>
            <List<OrgApplication>
              dataSource={apps.data}
              renderItem={(app) => (
                <List.Item>
                  <Space direction="vertical" size={0}>
                    <Space>
                      <Typography.Text strong>{app.name}</Typography.Text>
                      <Tag color={app.status === "rejected" ? "red" : app.status === "approved" ? "green" : "blue"}>
                        {t(STATUS[app.status]!)}
                      </Tag>
                    </Space>
                    <Typography.Text type="secondary">{formatBangkokDateTime(app.created_at)}</Typography.Text>
                    {app.reject_reason && <Typography.Text>{t("app.reason", { reason: app.reject_reason })}</Typography.Text>}
                  </Space>
                </List.Item>
              )}
            />
          </Card>
        )}
        {apps.isSuccess && !pending && (
          <Card>
            <Form layout="vertical">
              <Form.Item label={t("org.name")} htmlFor="org-name" {...item("name")}>
                <Input id="org-name" value={name} onChange={(e) => setName(e.target.value)} />
              </Form.Item>
              <Form.Item label={t("org.phone")} htmlFor="org-phone" {...item("contact_phone")}>
                <Input id="org-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
              </Form.Item>
              <Form.Item label={t("org.addressOptional")} htmlFor="org-address" {...item("address")}>
                <Input id="org-address" value={address} onChange={(e) => setAddress(e.target.value)} />
              </Form.Item>
              <ErrorText error={formLevel(error)} />
              <Button type="primary" loading={submit.pending} onClick={() => void submit.run()} style={{ marginTop: 8 }}>
                {t("org.submitApplication")}
              </Button>
            </Form>
          </Card>
        )}
      </Space>
    </Page>
  );
}
