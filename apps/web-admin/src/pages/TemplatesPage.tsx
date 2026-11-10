import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Card, Form, Input, Modal, Radio, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { ConfirmButton } from "../components/ConfirmButton";
import { ErrorText } from "../components/ErrorText";
import { Page } from "../components/Page";
import { RemoteSingleSelect } from "../components/RemoteSelect";
import { formatTime } from "../format";
import { useSubmit } from "../hooks/useSubmit";
import { useT, type T } from "../i18n";
import { errorMessage } from "../services/errors";
import {
  grantSummary,
  ownerLabel,
  SAMPLE_RUNNING,
  sampleKeys,
  samples,
  templateKeys,
  templates,
  type ListFilter,
  type Owner,
  type Sample,
  type TemplateSummary,
} from "../services/templates";

/** State handed to /templates/new and /templates/samples/:id: the chosen target and the
 * owner's label (the sample page lets the admin change the target before saving). */
export interface NewTemplateState {
  scope?: "system" | "tenant";
  owner?: Owner | null;
}

export function OwnerSelect({
  id,
  value,
  onChange,
  placeholder,
}: {
  id?: string;
  value: Owner | null;
  onChange: (owner: Owner | null) => void;
  placeholder?: string;
}) {
  const t = useT();
  return (
    <RemoteSingleSelect<Owner>
      id={id}
      value={value}
      onChange={onChange}
      placeholder={placeholder ?? t("tpl.ownerPlaceholder")}
      queryKey={templateKeys.owners("")}
      search={templates.owners}
      toOption={(o) => ({ value: o.tenant_id, label: ownerLabel(o, t) })}
    />
  );
}

/** "System", or the owner tenant by name (from the server, else from the filter's pick). */
export function ownerText(
  item: { scope: TemplateSummary["scope"]; tenant_id: number | null; owner_name?: string | null },
  known: Owner | null | undefined,
  t: T,
): string {
  if (item.scope === "system" || item.tenant_id === null) return t("tpl.ownerSystem");
  if (known && known.tenant_id === item.tenant_id) return ownerLabel(known, t);
  if (item.owner_name) {
    return `${t(item.scope === "personal" ? "kind.personal" : "kind.organization")} · ${item.owner_name}`;
  }
  return t(item.scope === "personal" ? "tpl.ownerPersonal" : "tpl.ownerOrganization", { id: item.tenant_id });
}

/** The grant line of a system template; the list carries no grant, so it comes from the detail. */
function GrantCell({ id }: { id: number }) {
  const t = useT();
  const detail = useQuery({ queryKey: templateKeys.one(id), queryFn: () => templates.get(id) });
  if (detail.isPending) return <span>…</span>;
  if (detail.isError) return <span>—</span>;
  return <span>{grantSummary(detail.data.grant, t)}</span>;
}

const SAMPLE_COLOR: Record<Sample["status"], string> = {
  QUEUED: "default",
  OCR_RUNNING: "processing",
  GENERATING: "processing",
  READY: "green",
  FAILED: "red",
  CANCELED: "default",
};

export function SampleStatusTag({ status }: { status: Sample["status"] }) {
  const t = useT();
  return <Tag color={SAMPLE_COLOR[status]}>{t(`sample.status.${status}`)}</Tag>;
}

/** The admin's own samples of the last seven days; a running one is read again every 5 s. */
function SamplesCard() {
  const t = useT();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const list = useQuery({
    queryKey: sampleKeys.list,
    queryFn: samples.list,
    refetchInterval: (q) => (q.state.data?.items.some((s) => SAMPLE_RUNNING.includes(s.status)) ? 5000 : false),
  });
  const items = list.data?.items ?? [];
  if (list.isError) return <ErrorText error={list.error} />;
  if (!items.length) return null;
  const columns: ColumnsType<Sample> = [
    { title: t("sample.col.created"), key: "created", render: (_, r) => formatTime(r.created_at) },
    {
      title: t("sample.col.file"),
      key: "file",
      render: (_, r) => `${(r.file_kind ?? "").toUpperCase()} · ${t("sample.pages", { n: r.pages ?? 1 })}`,
    },
    { title: t("col.status"), key: "status", render: (_, r) => <SampleStatusTag status={r.status} /> },
    { title: t("sample.col.expires"), key: "expires", render: (_, r) => formatTime(r.expires_at) },
    {
      title: t("col.actions"),
      key: "actions",
      render: (_, r) => (
        <Space>
          <Link to={`/templates/samples/${r.id}`}>{t("sample.open")}</Link>
          {!SAMPLE_RUNNING.includes(r.status) && (
            <ConfirmButton
              danger
              label={t("sample.delete")}
              title={t("sample.deleteTitle")}
              onConfirm={async () => {
                try {
                  await samples.remove(r.id);
                  void message.success(t("sample.deleted"));
                } catch (e) {
                  void message.error(errorMessage(e, t));
                }
                await queryClient.invalidateQueries({ queryKey: sampleKeys.list });
              }}
            />
          )}
        </Space>
      ),
    },
  ];
  return (
    <Card title={t("sample.listTitle")} size="small" data-testid="samples-card">
      <Table rowKey="id" size="small" columns={columns} dataSource={items} pagination={false} />
    </Card>
  );
}

/** System, personal and organization templates (FR-SYS-142). */
export function TemplatesPage() {
  const t = useT();
  const [scope, setScope] = useState<ListFilter["scope"]>("all");
  const [owner, setOwner] = useState<Owner | null>(null);
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [dialog, setDialog] = useState<"new" | "sample" | null>(null);
  const filter: ListFilter = { scope, tenantId: scope === "tenant" ? (owner?.tenant_id ?? null) : null, q };
  const list = useQuery({ queryKey: templateKeys.list(filter), queryFn: () => templates.list(filter) });

  const columns: ColumnsType<TemplateSummary> = [
    {
      title: t("tpl.col.name"),
      key: "name",
      render: (_, r) => <Link to={`/templates/${r.id}`}>{r.name || r.code}</Link>,
    },
    { title: t("tpl.col.code"), dataIndex: "code" },
    { title: t("tpl.col.owner"), key: "owner", render: (_, r) => ownerText(r, owner, t) },
    {
      title: t("col.status"),
      key: "status",
      render: (_, r) => (
        <Tag color={r.status === "ENABLED" ? "green" : "red"}>{t(`tpl.status.${r.status}`)}</Tag>
      ),
    },
    {
      title: t("tpl.col.current"),
      key: "current",
      render: (_, r) =>
        r.current_version ? t("tpl.version", { n: r.current_version.version }) : t("tpl.notActive"),
    },
    {
      title: t("tpl.col.draft"),
      key: "draft",
      render: (_, r) => (r.has_draft ? <Tag color="gold">{t("tpl.hasDraft")}</Tag> : "—"),
    },
    {
      title: t("tpl.col.grant"),
      key: "grant",
      render: (_, r) => (r.scope === "system" ? <GrantCell id={r.id} /> : "—"),
    },
    { title: t("tpl.col.updated"), key: "updated", render: (_, r) => formatTime(r.updated_at) },
  ];

  return (
    <Page
      name="templates"
      title={t("nav.templates")}
      extra={
        <Space>
          <Button onClick={() => setDialog("sample")}>{t("tpl.fromSample")}</Button>
          <Button type="primary" onClick={() => setDialog("new")}>
            {t("tpl.new")}
          </Button>
        </Space>
      }
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Alert type="info" showIcon message={t("tpl.adminNote")} />
        <Space wrap>
          <Radio.Group
            aria-label={t("tpl.filterScope")}
            optionType="button"
            value={scope}
            onChange={(e) => setScope(e.target.value as ListFilter["scope"])}
            options={[
              { value: "all", label: t("tpl.scope.all") },
              { value: "system", label: t("tpl.scope.system") },
              { value: "tenant", label: t("tpl.scope.tenant") },
            ]}
          />
          {scope === "tenant" && (
            <div style={{ width: 360 }}>
              <OwnerSelect value={owner} onChange={setOwner} placeholder={t("tpl.ownerAny")} />
            </div>
          )}
          <Input.Search
            aria-label={t("tpl.search")}
            placeholder={t("tpl.search")}
            allowClear
            value={text}
            onChange={(e) => setText(e.target.value)}
            onSearch={(v) => setQ(v)}
            style={{ width: 260 }}
          />
        </Space>
        {list.isError ? (
          <ErrorText error={list.error} />
        ) : (
          <Table
            data-testid="templates-table"
            rowKey="id"
            size="middle"
            loading={list.isPending}
            columns={columns}
            dataSource={list.data?.items ?? []}
            pagination={{ pageSize: 50, hideOnSinglePage: true }}
          />
        )}
        <SamplesCard />
      </Space>
      {dialog && <TargetDialog mode={dialog} onClose={() => setDialog(null)} />}
    </Page>
  );
}

/** Where a new template belongs: the system, or one customer tenant. From a sample, the file
 * is uploaded here and its page opens (the target can still be changed there before saving). */
function TargetDialog({ mode, onClose }: { mode: "new" | "sample"; onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [scope, setScope] = useState<"system" | "tenant">("system");
  const [owner, setOwner] = useState<Owner | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);

  const go = useSubmit(async () => {
    setProblem(null);
    setError(null);
    if (scope === "tenant" && !owner) return setProblem(t("field.tenant_id"));
    const state: NewTemplateState = { scope, owner };
    if (mode === "sample") {
      if (!file) return setProblem(t("sample.pickFile"));
      try {
        const sample = await samples.upload(file);
        queryClient.setQueryData(sampleKeys.one(sample.id), sample);
        void queryClient.invalidateQueries({ queryKey: sampleKeys.list });
        navigate(`/templates/samples/${sample.id}`, { state });
      } catch (e) {
        setError(e);
      }
      return;
    }
    const query = scope === "system" ? "scope=system" : `scope=tenant&tenant_id=${owner!.tenant_id}`;
    navigate(`/templates/new?${query}`, { state });
  });

  return (
    <Modal
      open
      title={t(mode === "sample" ? "sample.dialogTitle" : "tpl.target.title")}
      okText={t(mode === "sample" ? "sample.start" : "tpl.target.continue")}
      cancelText={t("common.cancel")}
      okButtonProps={{ loading: go.pending }}
      onOk={() => void go.run()}
      onCancel={onClose}
      destroyOnHidden
    >
      <Form layout="vertical">
        <Form.Item>
          <Radio.Group value={scope} onChange={(e) => setScope(e.target.value as "system" | "tenant")}>
            <Space direction="vertical">
              <Radio value="system">{t("tpl.target.system")}</Radio>
              <Radio value="tenant">{t("tpl.target.tenant")}</Radio>
            </Space>
          </Radio.Group>
        </Form.Item>
        {scope === "tenant" && (
          <Form.Item label={t("tpl.owner")} htmlFor="tpl-owner">
            <OwnerSelect id="tpl-owner" value={owner} onChange={setOwner} />
          </Form.Item>
        )}
        {mode === "sample" && (
          <Form.Item label={t("sample.file")} htmlFor="tpl-sample-file" extra={t("sample.uploadHint")}>
            <input
              id="tpl-sample-file"
              type="file"
              accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Form.Item>
        )}
        {mode === "sample" && <Alert type="info" showIcon message={t("sample.platformNote")} />}
        {problem && <Alert role="alert" type="error" showIcon message={problem} />}
        <ErrorText error={error} />
      </Form>
    </Modal>
  );
}
