import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Modal, Radio, Space, Spin, Typography } from "antd";
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
import { Icon } from "../layout/icons";
import { api, call } from "../services/api";
import { can } from "../tenants/permissions";
import { useTenant } from "../tenants/useTenant";

type Period = "month" | "year";
const PERIOD_KEY: Record<Period, MessageKey> = { month: "plans.periodMonth", year: "plans.periodYear" };

/** The price block: the first available price large, the other below it (FR-SYS-102). */
function Prices({ plan }: { plan: CatalogPlan }) {
  const t = useT();
  if (plan.monthly_price === null && plan.yearly_price === null) {
    return (
      <div className="pc-plan__price">
        <span className="pc-plan__price-main">{t("plans.contactUs")}</span>
      </div>
    );
  }
  const lines = [
    plan.monthly_price !== null && t("plans.perMonth", { price: formatTHB(plan.monthly_price, t) }),
    plan.yearly_price !== null && t("plans.perYear", { price: formatTHB(plan.yearly_price, t) }),
  ].filter((x): x is string => Boolean(x));
  return (
    <div className="pc-plan__price">
      <span className="pc-plan__price-main">{lines[0]}</span>
      {lines[1] && <span className="pc-plan__price-alt">{lines[1]}</span>}
    </div>
  );
}

/** One plan: badge and name, the price, what it includes, and the action pinned to the
 * bottom so every card's button lines up. Without an action the slot keeps its height. */
function PlanCard({
  plan,
  current,
  action,
  pending,
  onChoose,
}: {
  plan: CatalogPlan;
  current: boolean;
  action: "renew" | "apply" | null;
  pending: boolean;
  onChoose(): void;
}) {
  const t = useT();
  const org = plan.tenant_kind === "organization";
  return (
    <article className={current ? "pc-plan pc-plan--current" : "pc-plan"} data-plan={plan.code} data-testid={`plan-${plan.code}`}>
      {current && <span className="pc-plan__current">{t("plans.current")}</span>}
      <header className="pc-plan__head">
        <span className="pc-plan__badge" aria-hidden="true">
          <Icon name={org ? "org" : "user"} />
        </span>
        <div className="pc-plan__name">
          <h3>{planName(plan.code, t)}</h3>
          <span className="pc-plan__kind">{t(org ? "plans.kindOrganization" : "plans.kindPersonal")}</span>
        </div>
      </header>
      <Prices plan={plan} />
      <ul className="pc-plan__features">
        <li>
          <Icon name="check" />
          <span>{t("plans.quota", { n: formatCount(plan.monthly_quota) })}</span>
        </li>
        <li>
          <Icon name="check" />
          <span>{plan.member_limit === null ? t("plans.membersUnlimited") : t("plans.members", { n: plan.member_limit })}</span>
        </li>
      </ul>
      <div className="pc-plan__action">
        {action ? (
          <Button block size="large" type="primary" disabled={pending} onClick={onChoose}>
            {t(action === "renew" ? "plans.renew" : "plans.apply")}
          </Button>
        ) : (
          <span className="pc-plan__na">{current ? t("plans.inUse") : t("plans.unavailable")}</span>
        )}
      </div>
    </article>
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
        <section className="pc-plans" aria-labelledby="plans-heading">
          <div className="pc-plans__intro">
            <h2 id="plans-heading">{t("plans.choose")}</h2>
            <p>{t("plans.subtitle")}</p>
          </div>
          <div className="pc-plans__grid">
            {catalog.data.map((plan) => (
              <PlanCard
                key={plan.code}
                plan={plan}
                current={plan.code === current}
                action={applicableAction(plan, tenant?.kind ?? "personal", usage.data, mayApply)}
                pending={!!pending}
                onChoose={() => setChoosing(plan)}
              />
            ))}
          </div>
        </section>
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
