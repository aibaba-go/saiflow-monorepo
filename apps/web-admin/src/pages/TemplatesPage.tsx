import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Form, Input, Modal, Radio, Space, Table, Tag } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { Link, useNavigate } from "react-router-dom";

import { ErrorText } from "../components/ErrorText";
import { Page } from "../components/Page";
import { RemoteSingleSelect } from "../components/RemoteSelect";
import { formatTime } from "../format";
import { useT, type T } from "../i18n";
import {
  grantSummary,
  importedContent,
  ownerLabel,
  templateKeys,
  templates,
  type ListFilter,
  type Owner,
  type TemplateSummary,
} from "../services/templates";

/** State handed to /templates/new: an imported structure and the chosen owner's label. */
export interface NewTemplateState {
  content?: unknown;
  source?: "manual" | "import";
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

/** System, personal and organization templates (FR-SYS-142). */
export function TemplatesPage() {
  const t = useT();
  const [scope, setScope] = useState<ListFilter["scope"]>("all");
  const [owner, setOwner] = useState<Owner | null>(null);
  const [text, setText] = useState("");
  const [q, setQ] = useState("");
  const [dialog, setDialog] = useState<"new" | "import" | null>(null);
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
          <Button onClick={() => setDialog("import")}>{t("tpl.import")}</Button>
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
      </Space>
      {dialog && <TargetDialog mode={dialog} onClose={() => setDialog(null)} />}
    </Page>
  );
}

/** Where a new or imported template belongs: the system, or one customer tenant. */
function TargetDialog({ mode, onClose }: { mode: "new" | "import"; onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const [scope, setScope] = useState<"system" | "tenant">("system");
  const [owner, setOwner] = useState<Owner | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  async function go() {
    setProblem(null);
    if (scope === "tenant" && !owner) return setProblem(t("field.tenant_id"));
    const state: NewTemplateState = { source: mode === "import" ? "import" : "manual", owner };
    if (mode === "import") {
      if (!file) return setProblem(t("tpl.import.pickFile"));
      const content = importedContent(await file.text());
      if (!content) return setProblem(t("tpl.import.invalid"));
      state.content = content;
    }
    const query = scope === "system" ? "scope=system" : `scope=tenant&tenant_id=${owner!.tenant_id}`;
    navigate(`/templates/new?${query}`, { state });
  }

  return (
    <Modal
      open
      title={t(mode === "import" ? "tpl.target.importTitle" : "tpl.target.title")}
      okText={t("tpl.target.continue")}
      cancelText={t("common.cancel")}
      onOk={() => void go()}
      onCancel={onClose}
      destroyOnClose
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
        {mode === "import" && (
          <Form.Item label={t("tpl.import.file")} htmlFor="tpl-file" extra={t("tpl.import.note")}>
            <input
              id="tpl-file"
              type="file"
              accept=".json,application/json"
              onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            />
          </Form.Item>
        )}
        {problem && <Alert role="alert" type="error" showIcon message={problem} />}
      </Form>
    </Modal>
  );
}
