import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Card, DatePicker, Form, Result, Select, Space, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import type { Dayjs } from "dayjs";
import { useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";

import { ErrorText } from "../components/ErrorText";
import { fieldErrorText, formLevel, requireFields } from "../components/FieldError";
import { Page } from "../components/Page";
import { formatTime, PLAN_NAMES, toBangkokIso } from "../format";
import { useSubmit } from "../hooks/useSubmit";
import { useT } from "../i18n";
import {
  idParam,
  orgKeys,
  organizations,
  type Reservation,
  type Subscription,
  type SubscriptionBody,
} from "../services/organizations";

/** A tenant's subscriptions and reservations, and setting its subscription (FR-SYS-066).
 * ?kind=organization|personal only labels the page and the way back. */
export function TenantBillingPage() {
  const t = useT();
  const id = idParam(useParams().id);
  const [params] = useSearchParams();
  const kind = params.get("kind") === "personal" ? "personal" : "organization";
  if (id === null) return <Result status="404" title={t("common.notFound")} />;
  return (
    <Page
      title={t("billing.title", { id })}
      extra={
        kind === "organization" ? (
          <Link to={`/organizations/${id}`}>{t("billing.kind.organization")}</Link>
        ) : (
          <Typography.Text>{t("billing.kind.personal")}</Typography.Text>
        )
      }
    >
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        <SubscriptionForm id={id} />
        <History id={id} />
        <Reservations id={id} />
      </Space>
    </Page>
  );
}

function SubscriptionForm({ id }: { id: number }) {
  const t = useT();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const [plan, setPlan] = useState<string | undefined>();
  const [period, setPeriod] = useState("month");
  const [startsAt, setStartsAt] = useState<Dayjs | null>(null);
  const [endsAt, setEndsAt] = useState<Dayjs | null>(null);
  const [error, setError] = useState<unknown>(null);

  const { run, pending } = useSubmit(async () => {
    setError(null);
    const body: SubscriptionBody = { plan_code: plan!, period };
    if (startsAt) body.starts_at = toBangkokIso(startsAt);
    if (endsAt) body.ends_at = toBangkokIso(endsAt);
    try {
      await organizations.setSubscription(id, body);
      void message.success(t("billing.saved"));
    } catch (e) {
      setError(e);
    } finally {
      await queryClient.invalidateQueries({ queryKey: orgKeys.subscriptions(id) });
    }
  });

  function save() {
    const missing = requireFields({ plan_code: plan ?? "" });
    if (missing) setError(missing);
    else void run();
  }

  const item = (field: string) => {
    const text = fieldErrorText(error, field, t);
    return { validateStatus: text ? ("error" as const) : undefined, help: text };
  };

  return (
    <Card title={t("billing.set")}>
      <Form layout="vertical" onFinish={save} style={{ maxWidth: 480 }}>
        <Form.Item label={t("billing.plan")} htmlFor="sub-plan" {...item("plan_code")}>
          <Select
            id="sub-plan"
            value={plan}
            onChange={setPlan}
            options={Object.entries(PLAN_NAMES).map(([value, label]) => ({ value, label }))}
          />
        </Form.Item>
        <Form.Item label={t("billing.period")} htmlFor="sub-period" {...item("period")}>
          <Select
            id="sub-period"
            value={period}
            onChange={setPeriod}
            options={[
              { value: "month", label: t("period.month") },
              { value: "year", label: t("period.year") },
            ]}
          />
        </Form.Item>
        <Form.Item label={t("planApprove.startsAt")} {...item("starts_at")}>
          <DatePicker showTime value={startsAt} onChange={setStartsAt} style={{ width: "100%" }} />
        </Form.Item>
        <Form.Item label={t("planApprove.endsAt")} extra={t("planApprove.hint")} {...item("ends_at")}>
          <DatePicker showTime value={endsAt} onChange={setEndsAt} style={{ width: "100%" }} />
        </Form.Item>
        <Space direction="vertical" style={{ width: "100%" }}>
          <ErrorText error={formLevel(error)} />
          <Button type="primary" htmlType="submit" loading={pending}>
            {t("billing.save")}
          </Button>
        </Space>
      </Form>
    </Card>
  );
}

function History({ id }: { id: number }) {
  const t = useT();
  const list = useQuery({ queryKey: orgKeys.subscriptions(id), queryFn: () => organizations.subscriptions(id) });
  const columns: ColumnsType<Subscription> = [
    { title: t("billing.plan"), key: "plan", render: (_, s) => PLAN_NAMES[s.plan_code] ?? s.plan_code },
    { title: t("billing.period"), key: "period", render: (_, s) => t(`period.${s.period}`) },
    { title: t("col.startsAt"), key: "starts", render: (_, s) => formatTime(s.starts_at) },
    { title: t("col.endsAt"), key: "ends", render: (_, s) => formatTime(s.ends_at) },
    { title: t("col.source"), key: "source", render: (_, s) => t(`source.${s.source}`) },
  ];
  return (
    <Card title={t("billing.history")}>
      <ErrorText error={list.error} />
      <Table<Subscription>
        data-testid="subscription-history"
        rowKey="id"
        loading={list.isPending}
        dataSource={list.data ?? []}
        columns={columns}
        scroll={{ x: true }}
        pagination={{ pageSize: 20, hideOnSinglePage: true }}
      />
    </Card>
  );
}

function Reservations({ id }: { id: number }) {
  const t = useT();
  const list = useQuery({ queryKey: orgKeys.reservations(id), queryFn: () => organizations.reservations(id) });
  const columns: ColumnsType<Reservation> = [
    { title: t("col.reference"), dataIndex: "reference" },
    { title: t("col.pages"), dataIndex: "pages" },
    { title: t("col.fromFree"), dataIndex: "from_free" },
    { title: t("col.fromMonthly"), dataIndex: "from_monthly" },
    { title: t("col.month"), key: "month", render: (_, r) => r.month.slice(0, 7) },
    { title: t("col.reservedAt"), key: "reserved", render: (_, r) => formatTime(r.reserved_at) },
    { title: t("col.releasedAt"), key: "released", render: (_, r) => formatTime(r.released_at) },
  ];
  return (
    <Card title={t("billing.reservations")}>
      <ErrorText error={list.error} />
      <Table<Reservation>
        data-testid="reservations"
        rowKey="id"
        loading={list.isPending}
        dataSource={list.data ?? []}
        columns={columns}
        scroll={{ x: true }}
        pagination={{ pageSize: 50, hideOnSinglePage: true }}
      />
    </Card>
  );
}
