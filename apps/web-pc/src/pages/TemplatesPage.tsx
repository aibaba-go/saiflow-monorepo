import { useQueryClient } from "@tanstack/react-query";
import { App, Button, Space, Table, Tag, Typography } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { ConfirmButton } from "../components/ConfirmButton";
import { ErrorText } from "../components/ErrorText";
import { Page } from "../components/Page";
import { formatBangkokDate, formatBangkokDateTime } from "../format";
import { useT, type MessageKey } from "../i18n";
import { Icon } from "../layout/icons";
import { errorMessage } from "../services/errors";
import { deleteSample, useSamples, useTemplates, type Sample } from "../templates/api";
import { ScopeTag, StatusTag, TemplateGate } from "../templates/common";
import { SampleDialog } from "../templates/SampleDialog";

const SAMPLE_COLOR: Record<Sample["status"], string> = {
  QUEUED: "processing",
  OCR_RUNNING: "processing",
  GENERATING: "processing",
  READY: "success",
  FAILED: "error",
  CANCELED: "default",
};

function SampleList() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const samples = useSamples();
  return (
    <section className="pc-panel" aria-label={t("tpl.samples")}>
      <Typography.Title level={2} className="pc-section-title">
        {t("tpl.samples")}
      </Typography.Title>
      <Typography.Paragraph type="secondary">{t("tpl.samplesNote")}</Typography.Paragraph>
      <ErrorText error={samples.error} />
      <Table
        size="small"
        rowKey="id"
        loading={samples.isPending}
        dataSource={samples.data?.items ?? []}
        pagination={false}
        locale={{ emptyText: t("sample.empty") }}
        columns={[
          { key: "created", title: t("sample.col.created"), render: (_, s) => formatBangkokDateTime(s.created_at) },
          { key: "source", title: t("sample.col.source"), render: (_, s) => t(`sample.source.${s.source}` as MessageKey) },
          {
            key: "status",
            title: t("sample.col.status"),
            render: (_, s) => <Tag color={SAMPLE_COLOR[s.status]}>{t(`sample.status.${s.status}` as MessageKey)}</Tag>,
          },
          { key: "expires", title: t("sample.col.expires"), render: (_, s) => formatBangkokDate(s.expires_at) },
          {
            key: "action",
            title: t("tpl.col.action"),
            render: (_, s) => (
              <Space>
                <Button size="small" onClick={() => navigate(`/templates/samples/${s.id}`)}>
                  {t("sample.open")}
                </Button>
                <ConfirmButton
                  size="small"
                  danger
                  label={t("sample.delete")}
                  title={t("sample.deleteTitle")}
                  onConfirm={async () => {
                    try {
                      await deleteSample(s.id);
                      void message.success(t("sample.deleted"));
                    } catch (e) {
                      void message.error(errorMessage(e, t));
                    }
                    await queryClient.invalidateQueries({ queryKey: ["template-samples"] });
                  }}
                />
              </Space>
            ),
          },
        ]}
      />
    </section>
  );
}

function TemplateList() {
  const t = useT();
  const navigate = useNavigate();
  const templates = useTemplates();
  const [sampleOpen, setSampleOpen] = useState(false);

  // JSON import has no entry here (hidden by product decision 2026-11-10); export stays.
  return (
    <Page
      name="templates"
      title={t("nav.templates")}
      extra={
        <Space>
          <Button onClick={() => navigate("/templates/new")}>{t("tpl.newBlank")}</Button>
          <Button type="primary" icon={<Icon name="spark" />} onClick={() => setSampleOpen(true)}>
            {t("tpl.fromSample")}
          </Button>
        </Space>
      }
    >
      <section className="pc-panel" aria-label={t("tpl.list")}>
        <ErrorText error={templates.error} />
        <Table
          rowKey="id"
          loading={templates.isPending}
          dataSource={templates.data?.items ?? []}
          pagination={false}
          locale={{ emptyText: t("tpl.empty") }}
          columns={[
            { key: "name", title: t("tpl.col.name"), render: (_, x) => <strong>{x.name}</strong> },
            { key: "code", title: t("tpl.col.code"), render: (_, x) => <code>{x.code}</code> },
            { key: "scope", title: t("tpl.col.scope"), render: (_, x) => <ScopeTag scope={x.scope} /> },
            { key: "status", title: t("tpl.col.status"), render: (_, x) => <StatusTag status={x.status} /> },
            {
              key: "version",
              title: t("tpl.col.version"),
              render: (_, x) => (
                <Space size={4}>
                  {x.current_version ? t("tpl.version", { n: x.current_version.version }) : <Typography.Text type="secondary">{t("tpl.notActive")}</Typography.Text>}
                  {x.has_draft && <Tag color="warning">{t("tpl.draft")}</Tag>}
                </Space>
              ),
            },
            { key: "updated", title: t("tpl.col.updated"), render: (_, x) => formatBangkokDateTime(x.updated_at) },
            {
              key: "action",
              title: t("tpl.col.action"),
              render: (_, x) => (
                <Button size="small" onClick={() => navigate(`/templates/${x.id}`)}>
                  {x.can_manage ? t("tpl.edit") : t("tpl.view")}
                </Button>
              ),
            },
          ]}
        />
      </section>
      <SampleList />
      <SampleDialog
        open={sampleOpen}
        onClose={() => setSampleOpen(false)}
        onStarted={(s) => {
          setSampleOpen(false);
          navigate(`/templates/samples/${s.id}`);
        }}
      />
    </Page>
  );
}

/** The template list of the current tenant (FR-SYS-140, FR-TEMPLATE-001/002): from a
 * sample first, blank beside it. */
export function TemplatesPage() {
  return (
    <TemplateGate>
      <TemplateList />
    </TemplateGate>
  );
}
