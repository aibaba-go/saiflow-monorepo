import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Empty, Form, Input, Modal, Select, Space, Table, Tag, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";

import { ErrorText } from "../components/ErrorText";
import { Page } from "../components/Page";
import { formatTime } from "../format";
import { useSubmit } from "../hooks/useSubmit";
import { useT } from "../i18n";
import { idParam, orgKeys, organizations } from "../services/organizations";
import { reportKeys, reports, type ReportSummary } from "../services/reports";

const MAX_NAME = 120;

const STATUS_COLOR: Record<ReportSummary["status"], string> = { draft: "default", published: "success", changed: "warning" };

export function ReportStatusTag({ status }: { status: ReportSummary["status"] }) {
  const t = useT();
  return <Tag color={STATUS_COLOR[status]}>{t(`rpt.status.${status}`)}</Tag>;
}

/** The customer organizations, searchable by name (the list is small at the current scale). */
function OrgPicker({ value, onChange }: { value: number | null; onChange: (id: number | null) => void }) {
  const t = useT();
  const list = useQuery({ queryKey: orgKeys.all, queryFn: organizations.list });
  return (
    <>
      <Select
        id="rpa-org"
        className="ad-report-org"
        showSearch
        allowClear
        placeholder={t("rpa.orgPlaceholder")}
        loading={list.isPending}
        value={value ?? undefined}
        onChange={(v: number | undefined) => onChange(v ?? null)}
        optionFilterProp="label"
        options={(list.data ?? []).map((o) => ({ value: o.tenant_id, label: o.name }))}
      />
      <ErrorText error={list.error} />
    </>
  );
}

function CreateDialog({ tenantId, open, onClose }: { tenantId: number; open: boolean; onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [name, setName] = useState("");
  const [error, setError] = useState<unknown>(null);
  const trimmed = name.trim();
  const create = useSubmit(async () => {
    setError(null);
    try {
      const created = await reports.create(tenantId, trimmed);
      queryClient.setQueryData(reportKeys.one(created.id), created);
      void queryClient.invalidateQueries({ queryKey: reportKeys.lists });
      onClose();
      navigate(`/reports/${created.id}`);
    } catch (e) {
      setError(e);
    }
  });
  return (
    <Modal
      open={open}
      title={t("rpt.newTitle")}
      okText={t("rpt.create")}
      cancelText={t("common.cancel")}
      okButtonProps={{ disabled: !trimmed, loading: create.pending }}
      onOk={() => void create.run()}
      onCancel={onClose}
      afterClose={() => {
        setName("");
        setError(null);
      }}
      destroyOnHidden
    >
      <Form layout="vertical" onFinish={() => trimmed && void create.run()}>
        <Form.Item label={t("rpt.name")} htmlFor="rpa-new-name" required>
          <Input
            id="rpa-new-name"
            autoFocus
            value={name}
            maxLength={MAX_NAME}
            showCount
            onChange={(e) => setName(e.target.value)}
          />
        </Form.Item>
      </Form>
      <ErrorText error={error} />
    </Modal>
  );
}

function ReportList({ tenantId }: { tenantId: number }) {
  const t = useT();
  const list = useQuery({ queryKey: reportKeys.list(tenantId), queryFn: () => reports.list(tenantId) });
  const [creating, setCreating] = useState(false);
  const columns: ColumnsType<ReportSummary> = [
    { key: "name", title: t("rpt.col.name"), render: (_, r) => <Link to={`/reports/${r.id}`}>{r.name}</Link> },
    { key: "status", title: t("rpt.col.status"), render: (_, r) => <ReportStatusTag status={r.status} /> },
    {
      key: "version",
      title: t("rpt.col.version"),
      render: (_, r) =>
        r.published_version ? (
          <span>
            {t("rpt.version", { n: r.published_version })}
            {r.published_at && <Typography.Text type="secondary"> · {formatTime(r.published_at)}</Typography.Text>}
          </span>
        ) : (
          <Typography.Text type="secondary">{t("rpt.notPublished")}</Typography.Text>
        ),
    },
    { key: "updated", title: t("rpt.col.updated"), render: (_, r) => formatTime(r.updated_at) },
    {
      key: "action",
      title: t("col.actions"),
      render: (_, r) => <Link to={`/reports/${r.id}`}>{t("rpt.design")}</Link>,
    },
  ];
  return (
    <>
      <div className="ad-panel__toolbar">
        <Typography.Text strong>{t("rpa.reports")}</Typography.Text>
        <span style={{ flex: 1 }} />
        <Button type="primary" onClick={() => setCreating(true)}>
          {t("rpt.new")}
        </Button>
      </div>
      {list.isError ? (
        <ErrorText error={list.error} />
      ) : (
        <Table
          data-testid="reports-table"
          rowKey="id"
          loading={list.isPending}
          dataSource={list.data?.items ?? []}
          pagination={false}
          locale={{ emptyText: t("rpa.empty") }}
          columns={columns}
        />
      )}
      <CreateDialog tenantId={tenantId} open={creating} onClose={() => setCreating(false)} />
    </>
  );
}

/** /reports: one organization's report configurations (FR-SYS-143). The organization is in
 * the address (?tenant=), so the designer's back link returns to the same list. */
export function ReportsPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const tenantId = idParam(params.get("tenant") ?? undefined);
  const choose = (id: number | null) => setParams(id ? { tenant: String(id) } : {}, { replace: true });
  return (
    <Page name="reports" title={t("nav.reports")}>
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Alert type="info" showIcon message={t("rpa.note")} />
        <Form layout="inline">
          <Form.Item label={t("rpa.org")} htmlFor="rpa-org">
            <OrgPicker value={tenantId} onChange={choose} />
          </Form.Item>
        </Form>
        <div className="ad-panel">
          {tenantId ? (
            <ReportList key={tenantId} tenantId={tenantId} />
          ) : (
            <Empty style={{ padding: 32 }} description={t("rpa.chooseOrg")} />
          )}
        </div>
      </Space>
    </Page>
  );
}
