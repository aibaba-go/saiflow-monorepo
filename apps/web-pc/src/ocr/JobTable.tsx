import { Table, type TableProps } from "antd";
import { Link, useNavigate } from "react-router-dom";

import { useMe } from "../auth/session";
import { FileName } from "../components/FileName";
import { formatBangkokDateTime } from "../format";
import { useT } from "../i18n";
import { Icon } from "../layout/icons";
import { useTenant } from "../tenants/useTenant";
import { type JobOut } from "./api";
import { canEditJob, jobTarget } from "./stage";
import { StageTag } from "./StageTag";

const UNFINISHED = ["OCR_PROCESSING", "TEMPLATE_MATCHING", "OCR_FAILED"];

/** The prototype's task table (home "recent documents" and the library): file, template,
 * stage, pages, created time in Bangkok and the next action. A row opens the same place as
 * its action (FR-SYS-130). */
export function JobTable({
  rows,
  loading,
  pagination = false,
  emptyText,
  testId,
}: {
  rows: JobOut[];
  loading: boolean;
  pagination?: TableProps<JobOut>["pagination"];
  emptyText?: string;
  testId?: string;
}) {
  const t = useT();
  const navigate = useNavigate();
  const { tenant } = useTenant();
  const me = useMe();
  const editable = (j: JobOut) => canEditJob(j, tenant, me.data?.user_id);
  return (
    <Table<JobOut>
      data-testid={testId}
      className="pc-task-table"
      rowKey="id"
      tableLayout="fixed"
      loading={loading}
      dataSource={rows}
      locale={emptyText ? { emptyText } : undefined}
      pagination={pagination}
      onRow={(j) => ({ onClick: () => navigate(jobTarget(j, editable(j))), style: { cursor: "pointer" } })}
      columns={[
        { key: "file", title: t("table.file"), width: "32%", render: (_, j) => <FileName name={j.file_name} /> },
        { key: "template", title: t("table.template"), width: "19%", render: (_, j) => j.template_name ?? t("review.generic") },
        { key: "stage", title: t("table.stage"), width: "16%", render: (_, j) => <StageTag stage={j.stage} level={j.review_level} /> },
        { key: "pages", title: t("table.pages"), width: "7%", className: "num", render: (_, j) => j.page_count },
        { key: "at", title: t("table.created"), width: "15%", className: "num", render: (_, j) => formatBangkokDateTime(j.created_at) },
        {
          key: "action",
          title: t("table.action"),
          width: "11%",
          render: (_, j) => {
            const verify = j.stage === "VERIFYING" && editable(j);
            const label = verify ? t("ocr.goVerify") : UNFINISHED.includes(j.stage) ? t("action.viewProgress") : t("action.viewDetail");
            return (
              <Link
                to={jobTarget(j, editable(j))}
                className={`pc-table-action${verify ? " pc-table-action--primary" : ""}`}
                onClick={(e) => e.stopPropagation()}
              >
                {label}
                <Icon name="arrow" />
              </Link>
            );
          },
        },
      ]}
    />
  );
}
