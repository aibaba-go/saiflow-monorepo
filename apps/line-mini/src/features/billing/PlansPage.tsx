import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Button, Dialog, NoticeBar, Popup, Tag } from "antd-mobile";
import { useState } from "react";

import { BrandLoading } from "../../components/BrandLoading";
import { ErrorText } from "../../components/ErrorText";
import { useSubmit } from "../../hooks/useSubmit";
import { useT, type MessageKey } from "../../i18n";
import { api, call } from "../../services/api";
import { confirmAction } from "../../utils/confirm";
import { formatBangkokDateTime, formatCount } from "../../utils/format";
import { can } from "../tenants/permissions";
import { useCurrentTenant } from "../tenants/useCurrentTenant";
import { formatTHB } from "./money";
import { applicableAction, type CatalogPlan } from "./planRules";
import { planName } from "./UsageCard";
import { useUsage } from "./useUsage";

type Period = "month" | "year";
const PERIOD_KEY: Record<Period, MessageKey> = { month: "plans.periodMonth", year: "plans.periodYear" };

function Prices({ plan }: { plan: CatalogPlan }) {
  const t = useT();
  if (plan.monthly_price === null && plan.yearly_price === null) {
    return <div className="plan__price">{t("plans.contactUs")}</div>;
  }
  return (
    <>
      {plan.monthly_price !== null && (
        <div className="plan__price">{t("plans.perMonth", { price: formatTHB(plan.monthly_price, t) })}</div>
      )}
      {plan.yearly_price !== null && (
        <div className="plan__price">{t("plans.perYear", { price: formatTHB(plan.yearly_price, t) })}</div>
      )}
    </>
  );
}

/** Plans with prices, the current plan and renewal or upgrade applications (FR-SYS-053). */
export function PlansPage() {
  const t = useT();
  const client = useQueryClient();
  const { tenant } = useCurrentTenant();
  const usage = useUsage();
  const isUser = tenant !== null && tenant.kind !== "guest";
  const catalog = useQuery({
    queryKey: ["plans"],
    queryFn: () => call(api.GET("/api/v1/billing/plans")),
  });
  const applications = useQuery({
    queryKey: ["plan-applications", tenant?.tenant_id],
    queryFn: () => call(api.GET("/api/v1/billing/applications")),
    enabled: isUser,
  });
  const [choosing, setChoosing] = useState<CatalogPlan | null>(null);
  const [error, setError] = useState<unknown>(null);

  const submit = useSubmit(async (plan: CatalogPlan, period: Period) => {
    setError(null);
    try {
      await call(api.POST("/api/v1/billing/applications", { body: { plan_code: plan.code, period } }));
      await client.invalidateQueries({ queryKey: ["plan-applications"] });
      await Dialog.alert({ content: t("plans.received"), confirmText: t("common.ok") });
    } catch (err) {
      setError(err);
    }
  });

  const pick = async (period: Period) => {
    const plan = choosing;
    setChoosing(null);
    if (!plan) return;
    const title = t("plans.confirmTitle", { plan: planName(plan.code, t), period: t(PERIOD_KEY[period]) });
    if (await confirmAction(t, title)) await submit.run(plan, period);
  };

  if (catalog.isPending || usage.isPending) return <BrandLoading label={t("common.loading")} />;
  if (catalog.isError) return <ErrorText error={catalog.error} />;
  const pending = applications.data?.find((a) => a.status === "pending");
  const current = usage.data?.active ? usage.data.plan?.code : null;
  const mayApply = isUser && can(tenant, "plan_apply");

  return (
    <div className="page">
      <h1 className="page__title">{t("plans.title")}</h1>
      {pending && (
        <NoticeBar
          color="alert"
          wrap
          content={t("plans.pending", {
            plan: planName(pending.plan_code, t),
            period: t(PERIOD_KEY[pending.period]),
            date: formatBangkokDateTime(pending.created_at),
          })}
        />
      )}
      {!isUser && <div className="card-row__meta">{t("plans.guestNote")}</div>}
      <ErrorText error={error} />
      {catalog.data.map((plan) => {
        const action = applicableAction(plan, tenant?.kind ?? "guest", usage.data, mayApply);
        return (
          <div key={plan.code} className="card-row" data-plan={plan.code}>
            <div className="card-row__title">
              {planName(plan.code, t)} {plan.code === current && <Tag color="primary">{t("plans.current")}</Tag>}
            </div>
            <div className="card-row__meta">{t("plans.quota", { n: formatCount(plan.monthly_quota) })}</div>
            <div className="card-row__meta">
              {plan.member_limit === null
                ? t("plans.membersUnlimited")
                : t("plans.members", { n: plan.member_limit })}
            </div>
            <Prices plan={plan} />
            {action && (
              <Button
                size="small"
                color="primary"
                disabled={!!pending || submit.pending}
                onClick={() => setChoosing(plan)}
              >
                {t(action === "renew" ? "plans.renew" : "plans.apply")}
              </Button>
            )}
          </div>
        );
      })}
      <Popup visible={choosing !== null} onMaskClick={() => setChoosing(null)} bodyStyle={{ padding: 12 }}>
        <div className="section__label">{t("plans.choosePeriod")}</div>
        <div role="listbox" aria-label={t("plans.choosePeriod")} className="choice-list">
          {(["month", "year"] as Period[]).map((p) => (
            <button
              key={p}
              type="button"
              role="option"
              aria-selected={false}
              className="choice-list__item"
              onClick={() => void pick(p)}
            >
              {t(p === "month" ? "plans.monthly" : "plans.yearly")}
            </button>
          ))}
        </div>
      </Popup>
    </div>
  );
}
