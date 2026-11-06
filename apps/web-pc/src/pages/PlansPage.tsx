import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Col, Modal, Radio, Row, Space, Spin, Tag, Typography } from "antd";
import { useState } from "react";

import { formatTHB } from "../billing/money";
import { applicableAction, type CatalogPlan } from "../billing/planRules";
import { planName, UsageCard } from "../billing/UsageCard";
import { useUsage } from "../billing/useUsage";
import { ErrorText } from "../components/ErrorText";
import { Page } from "../components/Page";
import { formatBangkokDateTime, formatCount } from "../format";
import { useSubmit } from "../hooks/useSubmit";
import { useT, type MessageKey } from "../i18n";
import { api, call } from "../services/api";
import { can } from "../tenants/permissions";
import { useTenant } from "../tenants/useTenant";

type Period = "month" | "year";
const PERIOD_KEY: Record<Period, MessageKey> = { month: "plans.periodMonth", year: "plans.periodYear" };

function Prices({ plan }: { plan: CatalogPlan }) {
  const t = useT();
  if (plan.monthly_price === null && plan.yearly_price === null) return <Typography.Text>{t("plans.contactUs")}</Typography.Text>;
  return (
    <Space direction="vertical" size={0}>
      {plan.monthly_price !== null && <Typography.Text>{t("plans.perMonth", { price: formatTHB(plan.monthly_price, t) })}</Typography.Text>}
      {plan.yearly_price !== null && <Typography.Text>{t("plans.perYear", { price: formatTHB(plan.yearly_price, t) })}</Typography.Text>}
    </Space>
  );
}

/** Choose the period and confirm the target plan before applying (FR-SYS-102). */
function ApplyDialog({ plan, onSubmit, onClose }: { plan: CatalogPlan; onSubmit(period: Period): Promise<void>; onClose(): void }) {
  const t = useT();
  const [period, setPeriod] = useState<Period>("month");
  const submit = useSubmit(() => onSubmit(period));
  return (
    <Modal
      open
      title={t("plans.choosePeriod")}
      okText={t("common.confirm")}
      cancelText={t("common.cancel")}
      okButtonProps={{ loading: submit.pending, autoInsertSpace: false }}
      cancelButtonProps={{ autoInsertSpace: false }}
      onOk={() => void submit.run()}
      onCancel={onClose}
    >
      <Space direction="vertical" size="middle">
        <Radio.Group value={period} onChange={(e) => setPeriod(e.target.value as Period)}>
          <Radio value="month">{t("plans.monthly")}</Radio>
          <Radio value="year">{t("plans.yearly")}</Radio>
        </Radio.Group>
        <Typography.Text strong>{t("plans.confirmTitle", { plan: planName(plan.code, t), period: t(PERIOD_KEY[period]) })}</Typography.Text>
      </Space>
    </Modal>
  );
}

/** Plans with prices, the current plan and renewal or upgrade applications (FR-SYS-102). */
export function PlansPage() {
  const t = useT();
  const client = useQueryClient();
  const { tenant } = useTenant();
  const usage = useUsage();
  const catalog = useQuery({ queryKey: ["plans"], queryFn: () => call(api.GET("/api/v1/billing/plans")) });
  const applications = useQuery({
    queryKey: ["plan-applications", tenant?.tenant_id],
    queryFn: () => call(api.GET("/api/v1/billing/applications")),
    enabled: tenant !== null,
  });
  const [choosing, setChoosing] = useState<CatalogPlan | null>(null);
  const [received, setReceived] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const apply = async (plan: CatalogPlan, period: Period) => {
    setError(null);
    setReceived(false);
    try {
      await call(api.POST("/api/v1/billing/applications", { body: { plan_code: plan.code, period } }));
      setReceived(true);
      await client.invalidateQueries({ queryKey: ["plan-applications"] });
    } catch (err) {
      setError(err);
    } finally {
      setChoosing(null);
    }
  };

  const body = () => {
    if (catalog.isPending || usage.isPending) return <Spin />;
    if (catalog.isError) return <ErrorText error={catalog.error} />;
    const pending = applications.data?.find((a) => a.status === "pending");
    const current = usage.data?.active ? usage.data.plan?.code : null;
    const mayApply = can(tenant, "plan_apply");
    return (
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        {received && <Alert type="success" showIcon message={t("plans.received")} />}
        {pending && (
          <Alert
            type="info"
            showIcon
            message={t("plans.pending", {
              plan: planName(pending.plan_code, t),
              period: t(PERIOD_KEY[pending.period]),
              date: formatBangkokDateTime(pending.created_at),
            })}
          />
        )}
        <ErrorText error={error} />
        <UsageCard />
        <Row gutter={[16, 16]}>
          {catalog.data.map((plan) => {
            const action = applicableAction(plan, tenant?.kind ?? "personal", usage.data, mayApply);
            return (
              <Col key={plan.code} span={6}>
                <Card
                  data-testid={`plan-${plan.code}`}
                  title={
                    <Space>
                      {planName(plan.code, t)}
                      {plan.code === current && <Tag color="green">{t("plans.current")}</Tag>}
                    </Space>
                  }
                  style={{ height: "100%" }}
                >
                  <Space direction="vertical">
                    <Typography.Text>{t("plans.quota", { n: formatCount(plan.monthly_quota) })}</Typography.Text>
                    <Typography.Text>
                      {plan.member_limit === null ? t("plans.membersUnlimited") : t("plans.members", { n: plan.member_limit })}
                    </Typography.Text>
                    <Prices plan={plan} />
                    {action && (
                      <Button type="primary" disabled={!!pending} onClick={() => setChoosing(plan)}>
                        {t(action === "renew" ? "plans.renew" : "plans.apply")}
                      </Button>
                    )}
                  </Space>
                </Card>
              </Col>
            );
          })}
        </Row>
        {choosing && <ApplyDialog plan={choosing} onSubmit={(period) => apply(choosing, period)} onClose={() => setChoosing(null)} />}
      </Space>
    );
  };

  return (
    <Page name="plans" title={t("plans.title")}>
      {body()}
    </Page>
  );
}
