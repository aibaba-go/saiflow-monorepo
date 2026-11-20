import { useQueryClient } from "@tanstack/react-query";
import { Button, Card, Descriptions, Form, Input, Modal, Space, Typography } from "antd";
import { useState } from "react";

import { ME_KEY, useMe, type Me } from "../auth/session";
import { ErrorText } from "../components/ErrorText";
import { fieldErrorText, formLevel } from "../components/FieldError";
import { Page } from "../components/Page";
import { useSubmit } from "../hooks/useSubmit";
import { useT } from "../i18n";
import { EmailCodeButton } from "../profile/EmailCodeButton";
import { api, call } from "../services/api";

function useFieldProps(error: unknown) {
  const t = useT();
  return (field: string) => {
    const text = fieldErrorText(error, field, t);
    return { validateStatus: text ? ("error" as const) : undefined, help: text };
  };
}

function ChangeEmail({ onDone }: { onDone(): void }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<unknown>(null);
  const item = useFieldProps(error);
  const submit = useSubmit(async () => {
    setError(null);
    try {
      const me = await call(api.POST("/api/v1/me/email", { body: { email, code } }));
      queryClient.setQueryData(ME_KEY, me);
      onDone();
    } catch (err) {
      setError(err);
    }
  });
  return (
    <Form layout="vertical">
      <Form.Item label={t("profile.newEmail")} htmlFor="new-email" {...item("email")}>
        <div className="pc-email-row">
          <Input
            id="new-email"
            type="email"
            placeholder="name@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          <EmailCodeButton email={email} onError={setError} size="middle" />
        </div>
      </Form.Item>
      <Form.Item label={t("profile.code")} htmlFor="new-email-code" {...item("code")}>
        <Input id="new-email-code" value={code} onChange={(e) => setCode(e.target.value)} />
      </Form.Item>
      <ErrorText error={formLevel(error)} />
      <div className="pc-email-actions">
        <Button onClick={onDone}>{t("common.cancel")}</Button>
        <Button type="primary" loading={submit.pending} onClick={() => void submit.run()}>
          {t("common.confirm")}
        </Button>
      </div>
    </Form>
  );
}

function ProfileForm({ me }: { me: Me }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [name, setName] = useState(me.display_name ?? "");
  const [phone, setPhone] = useState(me.phone ?? "");
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  const item = useFieldProps(error);
  const save = useSubmit(async () => {
    setError(null);
    setSaved(false);
    try {
      const updated = await call(
        api.PATCH("/api/v1/me", { body: { display_name: name, phone: phone.trim() ? phone : null } }),
      );
      queryClient.setQueryData(ME_KEY, updated);
      setSaved(true);
    } catch (err) {
      setError(err);
    }
  });
  return (
    <Card title={t("profile.edit")} style={{ maxWidth: 520 }}>
      <Form layout="vertical">
        <Form.Item label={t("profile.nickname")} htmlFor="profile-name" {...item("display_name")}>
          <Input id="profile-name" value={name} maxLength={128} onChange={(e) => setName(e.target.value)} />
        </Form.Item>
        <Form.Item label={t("profile.phoneOptional")} htmlFor="profile-phone" {...item("phone")}>
          <Input id="profile-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </Form.Item>
        <ErrorText error={formLevel(error)} />
        <Space style={{ marginTop: 8 }}>
          <Button type="primary" loading={save.pending} onClick={() => void save.run()}>
            {t("common.save")}
          </Button>
          {saved && <Typography.Text type="success">{t("profile.saved")}</Typography.Text>}
        </Space>
      </Form>
    </Card>
  );
}

/** Profile (FR-SYS-095): nickname, phone (may be cleared) and email change with a code. */
export function ProfilePage() {
  const t = useT();
  const me = useMe().data;
  const [emailOpen, setEmailOpen] = useState(false);
  if (!me) return null;
  return (
    <Page name="profile" title={t("nav.profile")}>
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        <Descriptions bordered column={1} data-testid="profile-summary" style={{ maxWidth: 520 }}>
          <Descriptions.Item label={t("profile.nickname")}>{me.display_name ?? t("common.notSet")}</Descriptions.Item>
          <Descriptions.Item label={t("profile.email")}>
            <Space>
              {me.email ?? t("common.notSet")}
              <Button size="small" onClick={() => setEmailOpen(true)}>
                {t("profile.changeEmail")}
              </Button>
            </Space>
          </Descriptions.Item>
          <Descriptions.Item label={t("profile.phone")}>{me.phone ?? t("common.notSet")}</Descriptions.Item>
          <Descriptions.Item label={t("profile.line")}>{t("profile.lineLinked")}</Descriptions.Item>
        </Descriptions>
        <ProfileForm me={me} />
      </Space>
      <Modal open={emailOpen} title={t("profile.changeEmail")} footer={null} onCancel={() => setEmailOpen(false)} destroyOnHidden>
        <ChangeEmail onDone={() => setEmailOpen(false)} />
      </Modal>
    </Page>
  );
}
