import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Space, Table, Tabs } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { useSearchParams } from "react-router-dom";

import { useT, type MessageKey } from "../i18n";
import {
  asStatus,
  queueKey,
  STATUSES,
  type ApproveDates,
  type Queue,
} from "../services/applications";
import { hasField } from "../services/errors";
import { ConfirmButton } from "./ConfirmButton";
import { ErrorText } from "./ErrorText";
import { Page } from "./Page";
import { PlanApproveDialog } from "./PlanApproveDialog";
import { RejectDialog } from "./RejectDialog";

interface Row {
  id: number;
  status: string;
  reject_reason: string | null;
}

export interface ApplicationQueueProps<A extends Row> {
  title: MessageKey;
  queue: Queue<A>;
  columns: ColumnsType<A>;
  /** Approval opens a dialog for optional start and end (plan applications). */
  approveWithDates?: boolean;
}

/** An application queue by status (?status=, default pending) with approve and reject
 * (FR-SYS-063, 065, 067). After any action, or a failed one, the queue is reloaded so an
 * application someone else decided shows its real state (073-02). */
export function ApplicationQueue<A extends Row>({
  title,
  queue,
  columns,
  approveWithDates,
}: ApplicationQueueProps<A>) {
  const t = useT();
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const status = asStatus(params.get("status"));
  const list = useQuery({ queryKey: queueKey(queue.kind, status), queryFn: () => queue.list(status) });
  const [error, setError] = useState<unknown>(null);
  const [rejecting, setRejecting] = useState<number | null>(null);
  const [approving, setApproving] = useState<number | null>(null);

  const reload = () => queryClient.invalidateQueries({ queryKey: queueKey(queue.kind) });

  /** Run an action; a field error stays with its dialog, anything else shows on the page. */
  async function act(action: () => Promise<unknown>, close?: () => void) {
    setError(null);
    try {
      await action();
      close?.();
    } catch (e) {
      if (hasField(e, "reason") || hasField(e, "starts_at") || hasField(e, "ends_at")) throw e;
      close?.();
      setError(e);
    } finally {
      await reload();
    }
  }

  const actions: ColumnsType<A>[number] = {
    title: t("col.actions"),
    key: "actions",
    render: (_, row) => (
      <Space>
        {approveWithDates ? (
          <Button type="primary" onClick={() => setApproving(row.id)}>
            {t("app.approve")}
          </Button>
        ) : (
          <ConfirmButton
            type="primary"
            label={t("app.approve")}
            title={t("app.confirmApprove")}
            onConfirm={() => act(() => queue.approve(row.id))}
          />
        )}
        <Button danger onClick={() => setRejecting(row.id)}>
          {t("app.reject")}
        </Button>
      </Space>
    ),
  };
  const reason: ColumnsType<A>[number] = {
    title: t("col.rejectReason"),
    key: "reject_reason",
    render: (_, row) => row.reject_reason ?? "—",
  };
  const shown = [
    ...columns,
    ...(status === "rejected" ? [reason] : []),
    ...(status === "pending" ? [actions] : []),
  ];

  return (
    <Page title={t(title)}>
      <Tabs
        activeKey={status}
        onChange={(key) => setParams({ status: key })}
        items={STATUSES.map((s) => ({ key: s, label: t(`app.status.${s}`) }))}
      />
      <Space direction="vertical" style={{ width: "100%" }}>
        <ErrorText error={error ?? list.error} />
        <Table<A>
          rowKey="id"
          loading={list.isPending}
          dataSource={list.data ?? []}
          columns={shown}
          scroll={{ x: true }}
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
        />
      </Space>
      <RejectDialog
        key={`reject-${rejecting}`}
        open={rejecting !== null}
        onCancel={() => setRejecting(null)}
        onSubmit={(text) => act(() => queue.reject(rejecting!, text), () => setRejecting(null))}
      />
      {approveWithDates && (
        <PlanApproveDialog
          key={`approve-${approving}`}
          open={approving !== null}
          onCancel={() => setApproving(null)}
          onSubmit={(dates: ApproveDates) =>
            act(() => queue.approve(approving!, dates), () => setApproving(null))
          }
        />
      )}
    </Page>
  );
}
