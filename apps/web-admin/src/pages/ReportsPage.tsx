import type { ReportConfig } from "@saiflow/ui";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Empty, Form, Input, Modal, Progress, Select, Space, Table, Tag, Typography } from "antd";
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

type HomepageTemplate = Awaited<ReturnType<typeof reports.homepageTemplates>>["items"][number];

function HomepageTemplates() {
  const t = useT();
  const list = useQuery({ queryKey: ["admin-homepage-templates"], queryFn: ({ signal }) => reports.homepageTemplates(signal) });
  const [preview, setPreview] = useState<HomepageTemplate | null>(null);
  const names: Record<string, string> = { VERIFYING: t("rpa.homeVerifying"), OCR_PROCESSING: t("rpa.homeProcessing"), PENDING_REVIEW: t("rpa.homeReviewing"), CONFIRMED: t("rpa.homeConfirmed"), progress: t("rpa.homeProgress"), usage: t("rpa.homeUsage"), recent: t("rpa.homeRecent") };
  const counts = [12, 8, 6, 24];
  return <section className="ad-panel" aria-label={t("rpa.homeTemplates")}>
    <Typography.Title level={4}>{t("rpa.homeTemplates")}</Typography.Title>
    <ErrorText error={list.error} />
    <Table data-testid="homepage-templates" rowKey="id" loading={list.isPending} pagination={false} dataSource={list.data?.items ?? []} columns={[
      { key: "name", title: t("rpt.name"), dataIndex: "name" },
      { key: "source", title: t("nav.dataSources"), dataIndex: "source_id" },
      { key: "readonly", title: t("rpa.homeState"), render: () => <Tag>{t("rpa.homeReadonly")}</Tag> },
      { key: "preview", render: (_, item) => <Button onClick={() => setPreview(item)}>{t("rpa.homePreview")}</Button> },
    ]} />
    <Modal title={preview?.name} open={!!preview} onCancel={() => setPreview(null)} footer={null} width={980} destroyOnHidden>
      <Alert type="info" showIcon message={t("rpa.homeSynthetic")} />
      {preview && <div className="ad-home-preview">{(preview.config as unknown as ReportConfig).cards.map((c, i) => <section key={c.id} className="ad-home-preview__card" style={{ gridColumn: `${c.layout.x + 1} / span ${c.layout.w}`, gridRow: `${c.layout.y + 1} / span ${c.layout.h}` }}>
        <Typography.Text strong>{names[c.id] ?? c.id}</Typography.Text>
        {c.id === "progress" ? counts.map((n, index) => <div key={index}><span>{Object.values(names)[index]}</span><Progress percent={n * 2} /></div>) : c.id === "usage" ? <><Typography.Title level={2}>900 / 2,000</Typography.Title><Progress percent={45} /></> : c.id === "recent" ? <Table size="small" pagination={false} rowKey="id" dataSource={Array.from({ length: 5 }, (_, n) => ({ id: n, name: `Sample document ${n + 1}` }))} columns={[{ title: t("rpa.homeRecent"), dataIndex: "name" }]} /> : <Typography.Title level={2}>{counts[i]}</Typography.Title>}
      </section>)}</div>}
    </Modal>
  </section>;
}

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
        <HomepageTemplates />
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
