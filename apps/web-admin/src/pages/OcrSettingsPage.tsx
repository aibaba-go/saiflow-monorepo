import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Card, Descriptions, Form, Input, Select, Space, Spin, Tag } from "antd";
import { useState } from "react";

import { ConfirmButton } from "../components/ConfirmButton";
import { ErrorText } from "../components/ErrorText";
import { fieldErrorText, formLevel } from "../components/FieldError";
import { Page } from "../components/Page";
import { useT } from "../i18n";
import { asInt, catalog, catalogKeys, type OcrChanges, type OcrSettings } from "../services/catalog";

// FR-SYS-005, FR-SYS-072: Document AI OCR replaced Google Cloud Vision as the second engine.
const ENGINE_NAMES: Record<string, string> = { textin: "TextIn", google_docai: "Google Document AI OCR" };

/** OCR engine and LLM settings (FR-SYS-072). Keys show only whether they are set. */
export function OcrSettingsPage() {
  const t = useT();
  const current = useQuery({ queryKey: catalogKeys.ocr, queryFn: catalog.ocr });
  return (
    <Page name="ocr" title={t("nav.ocr")}>
      {current.isPending ? (
        <Spin />
      ) : current.isError ? (
        <ErrorText error={current.error} />
      ) : (
        <Space direction="vertical" size="large" style={{ width: "100%", maxWidth: 560 }}>
          <KeyStatus keys={current.data.keys} />
          <OcrForm key={JSON.stringify(current.data)} current={current.data} />
        </Space>
      )}
    </Page>
  );
}

function KeyStatus({ keys }: { keys: OcrSettings["keys"] }) {
  const t = useT();
  const tag = (set: boolean) =>
    set ? <Tag color="green">{t("ocr.keySet")}</Tag> : <Tag color="red">{t("ocr.keyMissing")}</Tag>;
  return (
    <Card title={t("ocr.keys")}>
      <Descriptions data-testid="ocr-keys" column={1} size="small">
        <Descriptions.Item label="TextIn">{tag(keys.textin)}</Descriptions.Item>
        <Descriptions.Item label={ENGINE_NAMES.google_docai}>{tag(keys.google_docai)}</Descriptions.Item>
        <Descriptions.Item label={t("ocr.llm")}>{tag(keys.llm)}</Descriptions.Item>
      </Descriptions>
      <Alert type="info" showIcon message={t("ocr.keyNote")} />
    </Card>
  );
}

type Text = Record<"retry_per_document" | "switch_threshold" | "probe_interval_seconds" | "llm_base_url" | "llm_model", string>;

function OcrForm({ current }: { current: OcrSettings }) {
  const t = useT();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [primary, setPrimary] = useState(current.primary_engine);
  const [backup, setBackup] = useState(current.backup_engine);
  const [text, setText] = useState<Text>({
    retry_per_document: String(current.retry_per_document),
    switch_threshold: String(current.switch_threshold),
    probe_interval_seconds: String(current.probe_interval_seconds),
    llm_base_url: current.llm_base_url,
    llm_model: current.llm_model,
  });
  const [error, setError] = useState<unknown>(null);

  // FR-SYS-162: only swap when the new default is the current backup; keep none and other drafts.
  function changePrimary(next: OcrSettings["primary_engine"]) {
    const oldPrimary = primary;
    setPrimary(next);
    if (next === backup) setBackup(oldPrimary);
  }

  function changes(): OcrChanges {
    const body: Record<string, unknown> = {};
    if (primary !== current.primary_engine) body.primary_engine = primary;
    if (backup !== current.backup_engine) body.backup_engine = backup;
    for (const field of ["retry_per_document", "switch_threshold", "probe_interval_seconds"] as const) {
      if (text[field].trim() !== String(current[field])) body[field] = asInt(text[field]);
    }
    for (const field of ["llm_base_url", "llm_model"] as const) {
      if (text[field].trim() !== current[field]) body[field] = text[field].trim();
    }
    return body as OcrChanges;
  }

  async function save() {
    const body = changes();
    if (Object.keys(body).length === 0) {
      void message.info(t("plans.noChange"));
      return;
    }
    setError(null);
    try {
      const saved = await catalog.updateOcr(body);
      queryClient.setQueryData(catalogKeys.ocr, saved);
      void message.success(t("ocr.saved"));
    } catch (e) {
      setError(e);
    }
  }

  const item = (field: string) => {
    const msg = fieldErrorText(error, field, t);
    return { validateStatus: msg ? ("error" as const) : undefined, help: msg };
  };
  const input = (field: keyof Text, label: Parameters<typeof t>[0], numeric = false) => (
    <Form.Item label={t(label)} htmlFor={`ocr-${field}`} {...item(field)}>
      <Input
        id={`ocr-${field}`}
        inputMode={numeric ? "numeric" : undefined}
        value={text[field]}
        onChange={(e) => setText({ ...text, [field]: e.target.value })}
      />
    </Form.Item>
  );
  const engines = Object.entries(ENGINE_NAMES).map(([value, label]) => ({ value, label }));

  return (
    <Card>
      <Form data-testid="ocr-form" layout="vertical">
        <Form.Item label={t("ocr.primary")} htmlFor="ocr-primary" extra={t("ocr.primaryNote")} {...item("primary_engine")}>
          <Select id="ocr-primary" value={primary} onChange={changePrimary} options={engines} />
        </Form.Item>
        <Form.Item label={t("ocr.backup")} htmlFor="ocr-backup" extra={t("ocr.backupNote")} {...item("backup_engine")}>
          <Select
            id="ocr-backup"
            value={backup}
            onChange={setBackup}
            options={[...engines, { value: "none", label: t("ocr.none") }]}
          />
        </Form.Item>
        {input("retry_per_document", "ocr.retry", true)}
        {input("switch_threshold", "ocr.threshold", true)}
        {input("probe_interval_seconds", "ocr.probe", true)}
        {input("llm_base_url", "ocr.llmBaseUrl")}
        {input("llm_model", "ocr.llmModel")}
        <Space direction="vertical" style={{ width: "100%" }}>
          <ErrorText error={formLevel(error)} />
          <ConfirmButton type="primary" label={t("common.save")} title={t("ocr.confirmSave")} onConfirm={save} />
        </Space>
      </Form>
    </Card>
  );
}
