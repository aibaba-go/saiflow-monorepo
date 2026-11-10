import { Button, Table, Tabs, Tag, Typography } from "antd";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { ErrorText } from "../components/ErrorText";
import { Page } from "../components/Page";
import { formatBangkokDateTime } from "../format";
import { useT } from "../i18n";
import { heldLevels, type Level, PAGE_SIZE, type ReviewItem, useReviewQueue } from "../reviews/api";
import { useTenant } from "../tenants/useTenant";

/** The review queue (FR-SYS-123): one tab per level the user holds, 20 per page, newest
 * first; items the user may not decide say why. A new tenant shows its own queue. */
export function ReviewsPage() {
  const t = useT();
  const navigate = useNavigate();
  const { tenant } = useTenant();
  const levels = heldLevels(tenant);
  const [picked, setPicked] = useState<Level | null>(null);
  const [page, setPage] = useState(1);
  const level = picked && levels.includes(picked) ? picked : (levels[0] ?? 1);
  const queue = useReviewQueue(level, page);

  if (!levels.length) {
    return (
      <Page name="reviews" title={t("nav.reviews")}>
        <Typography.Text>{t("review.noPermission")}</Typography.Text>
      </Page>
    );
  }
  return (
    <Page name="reviews" title={t("nav.reviews")}>
      <Tabs
        activeKey={String(level)}
        onChange={(k) => {
          setPicked(Number(k) as Level);
          setPage(1);
        }}
        items={levels.map((l) => ({ key: String(l), label: t(l === 2 ? "review.level2" : "review.level1") }))}
      />
      {queue.isError && <ErrorText error={queue.error} />}
      <Table<ReviewItem>
        rowKey="job_id"
        loading={queue.isPending}
        dataSource={queue.data?.items ?? []}
        locale={{ emptyText: t("review.empty") }}
        scroll={{ x: 1100 }}
        onRow={(r) => ({ onClick: () => navigate(`/reviews/${r.job_id}`), style: { cursor: "pointer" } })}
        pagination={{
          current: page,
          pageSize: PAGE_SIZE,
          total: queue.data?.total ?? 0,
          showSizeChanger: false,
          onChange: setPage,
        }}
        columns={[
          {
            key: "file",
            title: t("review.col.file"),
            render: (_, r) => (
              <>
                {r.file_name}
                {r.block_reason && (
                  <Tag color="orange" style={{ marginLeft: 8 }}>
                    {t(r.block_reason === "did_level1" ? "review.blocked.did_level1" : "review.blocked.own_confirmation")}
                  </Tag>
                )}
              </>
            ),
          },
          { key: "pages", title: t("review.col.pages"), align: "right", className: "num", render: (_, r) => r.page_count },
          { key: "template", title: t("review.col.template"), render: (_, r) => r.template_name ?? t("review.generic") },
          { key: "by", title: t("review.col.confirmedBy"), render: (_, r) => r.confirmed_by_name ?? "-" },
          {
            key: "at",
            title: t("review.col.confirmedAt"),
            render: (_, r) => (r.confirmed_at ? formatBangkokDateTime(r.confirmed_at) : "-"),
          },
          {
            key: "levels",
            title: t("review.col.levels"),
            render: (_, r) => t(r.required_level === 2 ? "review.settings.l2" : "review.settings.l1"),
          },
          {
            key: "actions",
            title: t("common.actions"),
            fixed: "right",
            width: 140,
            render: (_, r) => (
              <Button
                type={r.block_reason ? "default" : "primary"}
                onClick={(event) => {
                  event.stopPropagation();
                  navigate(`/reviews/${r.job_id}`);
                }}
              >
                {t(r.block_reason ? "action.viewDetail" : "review.open")}
              </Button>
            ),
          },
        ]}
      />
    </Page>
  );
}
