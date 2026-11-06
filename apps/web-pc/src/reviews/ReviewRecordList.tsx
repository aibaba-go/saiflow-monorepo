import { List, Tag, Typography } from "antd";

import { formatBangkokDateTime } from "../format";
import type { T } from "../i18n";
import type { ReviewRecord } from "./api";

/** Every review decision of a job, oldest first (FR-VERIFY-013). */
export function ReviewRecordList({ records, t }: { records: ReviewRecord[]; t: T }) {
  return (
    <List<ReviewRecord>
      size="small"
      bordered
      locale={{ emptyText: t("review.noRecords") }}
      dataSource={records}
      renderItem={(r) => (
        <List.Item>
          <List.Item.Meta
            title={
              <>
                <Tag color={r.decision === "APPROVE" ? "green" : "red"}>
                  {t(r.decision === "APPROVE" ? "review.decision.APPROVE" : "review.decision.RETURN")}
                </Tag>
                {t(r.level === 2 ? "review.level2" : "review.level1")}
              </>
            }
            description={
              <>
                <Typography.Text type="secondary">
                  {r.reviewer_name ?? "-"} · {formatBangkokDateTime(r.created_at)}
                </Typography.Text>
                {r.comment && <div>{r.comment}</div>}
              </>
            }
          />
        </List.Item>
      )}
    />
  );
}
