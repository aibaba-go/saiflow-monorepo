import { Button, Card, Empty, Space, Statistic, Table } from "antd";
import { Link, useNavigate } from "react-router-dom";

import { useMe } from "../auth/session";
import { UsageCard } from "../billing/UsageCard";
import { Page } from "../components/Page";
import { formatBangkokDateTime } from "../format";
import { useT } from "../i18n";
import { type JobOut, useJobs } from "../ocr/api";
import { canEditJob, jobTarget } from "../ocr/stage";
import { StageTag } from "../ocr/StageTag";
import { can } from "../tenants/permissions";
import { useTenant } from "../tenants/useTenant";

/** Home (FR-SYS-094): the current tenant's usage and the way to the plans; the number of
 * tasks to verify; the latest five tasks, or the way to Upload when there are none. */
export function HomePage() {
  const t = useT();
  const navigate = useNavigate();
  const { tenant } = useTenant();
  const me = useMe();
  const canVerify = can(tenant, "verify_own") || can(tenant, "verify_others");
  // only the jobs this user may verify (minor-fixes-ui)
  const toVerify = useJobs({ page: 1, pageSize: 100, stage: "VERIFYING" });
  const verifiable = (toVerify.data?.items ?? []).filter((j) => canEditJob(j, tenant, me.data?.user_id)).length;
  const recent = useJobs({ page: 1, pageSize: 5 });
  const rows = recent.data?.items ?? [];
  return (
    <Page name="home" title={t("nav.home")}>
      <Space direction="vertical" size="large" style={{ width: "100%", maxWidth: 1000 }}>
        <UsageCard />
        <Link to="/plans">{t("my.plans")}</Link>
        {canVerify && (
          <Card size="small" data-testid="to-verify">
            <Link to="/verify">
              <Statistic title={t("home.toVerify")} value={verifiable} loading={toVerify.isPending} />
            </Link>
          </Card>
        )}
        <Card size="small" title={t("home.recent")}>
          {!recent.isPending && !rows.length ? (
            <Empty description={t("home.noTasks")}>
              {can(tenant, "upload_ocr") && (
                <Button type="primary" onClick={() => navigate("/upload")}>
                  {t("nav.upload")}
                </Button>
              )}
            </Empty>
          ) : (
            <Table<JobOut>
              data-testid="recent-tasks"
              size="small"
              rowKey="id"
              loading={recent.isPending}
              pagination={false}
              dataSource={rows}
              onRow={(j) => ({ onClick: () => navigate(jobTarget(j, canEditJob(j, tenant, me.data?.user_id))), style: { cursor: "pointer" } })}
              columns={[
                { key: "file", title: t("review.col.file"), render: (_, j) => j.file_name },
                { key: "stage", title: t("ocr.status"), render: (_, j) => <StageTag stage={j.stage} level={j.review_level} /> },
                { key: "template", title: t("review.col.template"), render: (_, j) => j.template_name ?? t("review.generic") },
                { key: "at", title: t("library.createdAt"), render: (_, j) => formatBangkokDateTime(j.created_at) },
              ]}
            />
          )}
        </Card>
      </Space>
    </Page>
  );
}
