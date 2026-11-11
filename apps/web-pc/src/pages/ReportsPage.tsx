import { useQueryClient } from "@tanstack/react-query";
import { Button, Form, Input, Modal, Space, Table, Typography } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { ErrorText } from "../components/ErrorText";
import { Page } from "../components/Page";
import { formatBangkokDateTime } from "../format";
import { useSubmit } from "../hooks/useSubmit";
import { useT } from "../i18n";
import { Icon } from "../layout/icons";
import { createReport, useReports } from "../reports/api";
import { ReportGate, ReportStatusTag, useReportAccess } from "../reports/common";
import { useTenant } from "../tenants/useTenant";

const MAX_NAME = 120;

function CreateDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { tenant } = useTenant();
  const [name, setName] = useState("");
  const [error, setError] = useState<unknown>(null);
  const trimmed = name.trim();
  const create = useSubmit(async () => {
    setError(null);
    try {
      const created = await createReport(trimmed);
      queryClient.setQueryData(["report", tenant?.tenant_id, created.id], created);
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
      onClose();
      navigate(`/reports/${created.id}/design`);
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
        <Form.Item label={t("rpt.name")} required>
          <Input autoFocus value={name} maxLength={MAX_NAME} showCount onChange={(e) => setName(e.target.value)} />
        </Form.Item>
      </Form>
      <ErrorText error={error} />
    </Modal>
  );
}

function ReportList() {
  const t = useT();
  const navigate = useNavigate();
  const reports = useReports();
  const { access } = useReportAccess();
  const [creating, setCreating] = useState(false);
  return (
    <Page
      name="reports"
      title={t("nav.reports")}
      extra={
        access.manage && (
          <Button type="primary" icon={<Icon name="plus" />} onClick={() => setCreating(true)}>
            {t("rpt.new")}
          </Button>
        )
      }
    >
      <section className="pc-panel" aria-label={t("rpt.list")}>
        <ErrorText error={reports.error} />
        <Table
          rowKey="id"
          loading={reports.isPending}
          dataSource={reports.data?.items ?? []}
          pagination={false}
          locale={{ emptyText: t(access.manage ? "rpt.emptyManage" : "rpt.emptyView") }}
          columns={[
            { key: "name", title: t("rpt.col.name"), render: (_, r) => <strong>{r.name}</strong> },
            { key: "status", title: t("rpt.col.status"), render: (_, r) => <ReportStatusTag status={r.status} /> },
            {
              key: "version",
              title: t("rpt.col.version"),
              render: (_, r) =>
                r.published_version ? (
                  <span>
                    {t("rpt.version", { n: r.published_version })}
                    {r.published_at && (
                      <Typography.Text type="secondary"> · {formatBangkokDateTime(r.published_at)}</Typography.Text>
                    )}
                  </span>
                ) : (
                  <Typography.Text type="secondary">{t("rpt.notPublished")}</Typography.Text>
                ),
            },
            { key: "updated", title: t("rpt.col.updated"), render: (_, r) => formatBangkokDateTime(r.updated_at) },
            {
              key: "action",
              title: t("common.actions"),
              render: (_, r) => (
                <Space>
                  {access.view && r.published_version && (
                    <Button size="small" type="primary" ghost onClick={() => navigate(`/reports/${r.id}`)}>
                      {t("rpt.open")}
                    </Button>
                  )}
                  {r.can_manage && (
                    <Button size="small" onClick={() => navigate(`/reports/${r.id}/design`)}>
                      {t("rpt.design")}
                    </Button>
                  )}
                </Space>
              ),
            },
          ]}
        />
      </section>
      <CreateDialog open={creating} onClose={() => setCreating(false)} />
    </Page>
  );
}

/** The reports of the current organization (FR-SYS-141, FR-REPORT-001): designers see every
 * report with its status; viewers see the published ones under their published names. */
export function ReportsPage() {
  return (
    <ReportGate need="any">
      <ReportList />
    </ReportGate>
  );
}
