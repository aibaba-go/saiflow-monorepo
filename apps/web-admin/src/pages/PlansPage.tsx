import { useQuery, useQueryClient } from "@tanstack/react-query";
import { App, Button, Form, Input, Modal, Space, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";

import { ConfirmButton } from "../components/ConfirmButton";
import { ErrorText } from "../components/ErrorText";
import { fieldErrorText, formLevel } from "../components/FieldError";
import { Page } from "../components/Page";
import { PLAN_NAMES } from "../format";
import { useT } from "../i18n";
import { asInt, catalog, catalogKeys, formatPrice, priceInput, type Plan, type PlanChanges } from "../services/catalog";

/** Plan catalog: quota, member limit and prices of the four plans (FR-SYS-068). */
export function PlansPage() {
  const t = useT();
  const list = useQuery({ queryKey: catalogKeys.plans, queryFn: catalog.plans });
  const [editing, setEditing] = useState<Plan | null>(null);

  const columns: ColumnsType<Plan> = [
    { title: t("plans.name"), key: "name", render: (_, p) => PLAN_NAMES[p.code] ?? p.code },
    { title: t("plans.kind"), key: "kind", render: (_, p) => t(`kind.${p.tenant_kind}`) },
    { title: t("plans.quota"), key: "quota", render: (_, p) => p.monthly_quota.toLocaleString("en-US") },
    {
      title: t("plans.memberLimit"),
      key: "limit",
      render: (_, p) => (p.member_limit === null ? t("plans.unlimited") : p.member_limit),
    },
    { title: t("plans.monthlyPrice"), key: "monthly", render: (_, p) => formatPrice(p.monthly_price) ?? t("plans.contactUs") },
    { title: t("plans.yearlyPrice"), key: "yearly", render: (_, p) => formatPrice(p.yearly_price) ?? t("plans.contactUs") },
    {
      title: t("col.actions"),
      key: "actions",
      render: (_, p) => <Button onClick={() => setEditing(p)}>{t("plans.edit")}</Button>,
    },
  ];

  return (
    <Page name="plans" title={t("nav.plans")}>
      <ErrorText error={list.error} />
      <Table<Plan>
        rowKey="code"
        loading={list.isPending}
        dataSource={list.data ?? []}
        columns={columns}
        pagination={false}
        scroll={{ x: true }}
      />
      {editing && <PlanDialog key={editing.code} plan={editing} onClose={() => setEditing(null)} />}
    </Page>
  );
}

function PlanDialog({ plan, onClose }: { plan: Plan; onClose(): void }) {
  const t = useT();
  const { message } = App.useApp();
  const queryClient = useQueryClient();
  const kinder = plan.code === "kinder";
  const [quota, setQuota] = useState(String(plan.monthly_quota));
  const [limit, setLimit] = useState(plan.member_limit === null ? "" : String(plan.member_limit));
  const [monthly, setMonthly] = useState(priceInput(plan.monthly_price));
  const [yearly, setYearly] = useState(priceInput(plan.yearly_price));
  const [error, setError] = useState<unknown>(null);

  /** Only the fields that changed (the backend leaves absent fields alone). */
  function changes(): PlanChanges {
    const body: PlanChanges = {};
    if (quota.trim() !== String(plan.monthly_quota)) body.monthly_quota = asInt(quota);
    const oldLimit = plan.member_limit === null ? "" : String(plan.member_limit);
    if (!kinder && limit.trim() !== oldLimit) body.member_limit = limit.trim() ? asInt(limit) : null;
    if (monthly.trim() !== priceInput(plan.monthly_price)) body.monthly_price = monthly.trim() || null;
    if (yearly.trim() !== priceInput(plan.yearly_price)) body.yearly_price = yearly.trim() || null;
    return body;
  }

  async function save() {
    const body = changes();
    if (Object.keys(body).length === 0) {
      void message.info(t("plans.noChange"));
      return;
    }
    setError(null);
    try {
      await catalog.updatePlan(plan.code, body);
      await queryClient.invalidateQueries({ queryKey: catalogKeys.plans });
      onClose();
    } catch (e) {
      setError(e);
    }
  }

  const item = (field: string) => {
    const text = fieldErrorText(error, field, t);
    return { validateStatus: text ? ("error" as const) : undefined, help: text };
  };

  return (
    <Modal
      open
      title={t("plans.editTitle", { name: PLAN_NAMES[plan.code] ?? plan.code })}
      onCancel={onClose}
      footer={
        <Space>
          <Button onClick={onClose} autoInsertSpace={false}>
            {t("common.cancel")}
          </Button>
          <ConfirmButton type="primary" label={t("common.save")} title={t("plans.confirmSave")} onConfirm={save} />
        </Space>
      }
    >
      <Form layout="vertical">
        <Form.Item label={t("plans.quota")} htmlFor="plan-quota" {...item("monthly_quota")}>
          <Input id="plan-quota" inputMode="numeric" value={quota} onChange={(e) => setQuota(e.target.value)} />
        </Form.Item>
        {kinder ? (
          <Form.Item label={t("plans.memberLimit")}>
            <Typography.Text>1</Typography.Text>{" "}
            <Typography.Text type="secondary">{t("plans.kinderLimit")}</Typography.Text>
          </Form.Item>
        ) : (
          <Form.Item
            label={t("plans.memberLimit")}
            htmlFor="plan-limit"
            extra={t("plans.memberLimitHint")}
            {...item("member_limit")}
          >
            <Input id="plan-limit" inputMode="numeric" value={limit} onChange={(e) => setLimit(e.target.value)} />
          </Form.Item>
        )}
        <Form.Item label={t("plans.monthlyPrice")} htmlFor="plan-monthly" extra={t("plans.priceHint")} {...item("monthly_price")}>
          <Input id="plan-monthly" inputMode="decimal" value={monthly} onChange={(e) => setMonthly(e.target.value)} />
        </Form.Item>
        <Form.Item label={t("plans.yearlyPrice")} htmlFor="plan-yearly" {...item("yearly_price")}>
          <Input id="plan-yearly" inputMode="decimal" value={yearly} onChange={(e) => setYearly(e.target.value)} />
        </Form.Item>
        <ErrorText error={formLevel(error)} />
      </Form>
    </Modal>
  );
}
