import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Card, Form, Input, Space, Spin, Typography } from "antd";
import { useState } from "react";

import { ConfirmButton } from "../components/ConfirmButton";
import { ErrorText } from "../components/ErrorText";
import { fieldErrorText, formLevel } from "../components/FieldError";
import { Page } from "../components/Page";
import { useT, type MessageKey } from "../i18n";
import { asInt, catalog, catalogKeys, type SettingPath } from "../services/catalog";

const SETTINGS: { path: SettingPath; label: MessageKey }[] = [
  { path: "free-quota-personal", label: "settings.freePersonal" },
  { path: "free-quota-organization", label: "settings.freeOrganization" },
  { path: "org-member-limit-unpaid", label: "settings.memberLimit" },
];

/** System parameters: the two free quotas and the unpaid member limit (FR-SYS-069). */
export function SettingsPage() {
  const t = useT();
  return (
    <Page title={t("nav.settings")}>
      <Space direction="vertical" size="large" style={{ width: "100%", maxWidth: 520 }}>
        <Alert type="info" showIcon message={t("settings.freeNote")} />
        {SETTINGS.map((s) => (
          <SettingCard key={s.path} path={s.path} label={s.label} />
        ))}
      </Space>
    </Page>
  );
}

function SettingCard({ path, label }: { path: SettingPath; label: MessageKey }) {
  const t = useT();
  const setting = useQuery({ queryKey: catalogKeys.setting(path), queryFn: () => catalog.getSetting(path) });
  return (
    <Card data-testid={`setting-${path}`} title={t(label)}>
      {setting.isPending ? (
        <Spin />
      ) : setting.isError ? (
        <ErrorText error={setting.error} />
      ) : (
        <SettingForm path={path} label={label} value={setting.data.value} />
      )}
    </Card>
  );
}

function SettingForm({ path, label, value }: { path: SettingPath; label: MessageKey; value: number }) {
  const t = useT();
  const queryClient = useQueryClient();
  const [text, setText] = useState(String(value));
  const [error, setError] = useState<unknown>(null);
  const [saved, setSaved] = useState(false);
  /** Runs after the confirmation (FR-SYS-073); ConfirmButton keeps it to one at a time. */
  async function save() {
    setError(null);
    setSaved(false);
    try {
      const result = await catalog.setSetting(path, asInt(text));
      queryClient.setQueryData(catalogKeys.setting(path), result);
      setSaved(true);
    } catch (e) {
      setError(e);
    }
  }
  const fieldError = fieldErrorText(error, "value", t);
  const id = `setting-${path}-input`;
  return (
    <Form layout="vertical">
      <Form.Item label={t(label)} htmlFor={id} validateStatus={fieldError ? "error" : undefined} help={fieldError}>
        <Input
          id={id}
          inputMode="numeric"
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setSaved(false);
          }}
          style={{ maxWidth: 200 }}
        />
      </Form.Item>
      <Space>
        <ConfirmButton type="primary" label={t("common.save")} title={t("settings.confirmSave")} onConfirm={save} />
        {saved && <Typography.Text type="success">{t("settings.saved")}</Typography.Text>}
      </Space>
      <ErrorText error={formLevel(error)} />
    </Form>
  );
}
