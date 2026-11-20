import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Building2, Check, House, UserRound } from "lucide-react";
import { useState } from "react";
import { Link } from "react-router-dom";

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
import { Alert } from "../../components/ui/alert";
import { alertDialog } from "../../components/ui/dialogs";
import { Button } from "../../components/ui/button";
import { BottomSheet } from "../../components/ui/sheet";

type Period = "month" | "year";
const PERIOD_KEY: Record<Period, MessageKey> = { month: "plans.periodMonth", year: "plans.periodYear" };

/** The price block: the first available price large, the other below it (FR-SYS-053). */
function Prices({ plan }: { plan: CatalogPlan }) {
  const t = useT();
  const lines = [
    plan.monthly_price !== null && t("plans.perMonth", { price: formatTHB(plan.monthly_price, t) }),
    plan.yearly_price !== null && t("plans.perYear", { price: formatTHB(plan.yearly_price, t) }),
  ].filter((x): x is string => Boolean(x));
  return (
    <div className="plan__price">
      <span className={lines[0] ? "plan__price-main" : "plan__price-main plan__price-main--contact"}>
        {lines[0] ?? t("plans.contactUs")}
      </span>
      {lines[1] && <span className="plan__price-alt">{lines[1]}</span>}
    </div>
  );
}

/** One plan: tier badge and name, the price, what it includes and the action at the bottom.
 * The current plan is outlined and labelled; a member who may apply but cannot pick this
 * tier sees why instead of a button. */
function PlanCard({
  plan,
  current,
  action,
  mayApply,
  disabled,
  onChoose,
}: {
  plan: CatalogPlan;
  current: boolean;
  action: "renew" | "apply" | null;
  mayApply: boolean;
  disabled: boolean;
  onChoose(): void;
}) {
  const t = useT();
  const org = plan.tenant_kind === "organization";
  const TierIcon = org ? Building2 : UserRound;
  const note = action ? null : current ? t("plans.inUse") : mayApply ? t("plans.unavailable") : null;
  return (
    <article className={current ? "plan plan--current" : "plan"} data-plan={plan.code}>
      <header className="plan__head">
        <span className="plan__badge" aria-hidden="true">
          <TierIcon size={20} strokeWidth={2} />
        </span>
        <div className="plan__name">
          <h2 className="plan__title">{planName(plan.code, t)}</h2>
          <span className="plan__kind">{t(org ? "plans.kindOrganization" : "plans.kindPersonal")}</span>
        </div>
        {current && <span className="plan__current">{t("plans.current")}</span>}
      </header>
      <Prices plan={plan} />
      <ul className="plan__features">
        <li>
          <Check size={16} strokeWidth={2.5} aria-hidden="true" />
          <span>{t("plans.quota", { n: formatCount(plan.monthly_quota) })}</span>
        </li>
        <li>
          <Check size={16} strokeWidth={2.5} aria-hidden="true" />
          <span>{plan.member_limit === null ? t("plans.membersUnlimited") : t("plans.members", { n: plan.member_limit })}</span>
        </li>
      </ul>
      {action && (
        <Button block variant="primary" disabled={disabled} onClick={onChoose}>
          {t(action === "renew" ? "plans.renew" : "plans.apply")}
        </Button>
      )}
      {note && <div className="plan__na">{note}</div>}
    </article>
  );
}

/** Plans has no tab bar and is often opened straight from a link: a way back home. */
function BackHome() {
  const t = useT();
  return (
    <nav className="plans__nav">
      <Link to="/" className="back-home">
        <House size={16} strokeWidth={2.25} aria-hidden="true" />
        <span>{t("plans.backHome")}</span>
      </Link>
    </nav>
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
      await alertDialog({ content: t("plans.received"), confirmText: t("common.ok") });
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
  if (catalog.isError)
    return (
      <div className="page">
        <BackHome />
        <ErrorText error={catalog.error} />
      </div>
    );
  const pending = applications.data?.find((a) => a.status === "pending");
  const current = usage.data?.active ? usage.data.plan?.code : null;
  const mayApply = isUser && can(tenant, "plan_apply");

  return (
    <div className="page">
      <BackHome />
      <div>
        <h1 className="page__title plans__title">{t("plans.title")}</h1>
        <p className="plans__subtitle">{t(isUser ? "plans.subtitle" : "plans.guestNote")}</p>
      </div>
      {pending && (
        <Alert tone="warning">
          {t("plans.pending", {
            plan: planName(pending.plan_code, t),
            period: t(PERIOD_KEY[pending.period]),
            date: formatBangkokDateTime(pending.created_at),
          })}
        </Alert>
      )}
      <ErrorText error={error} />
      <div className="plans">
        {catalog.data.map((plan) => (
          <PlanCard
            key={plan.code}
            plan={plan}
            current={plan.code === current}
            action={applicableAction(plan, tenant?.kind ?? "guest", usage.data, mayApply)}
            mayApply={mayApply}
            disabled={!!pending || submit.pending}
            onChoose={() => setChoosing(plan)}
          />
        ))}
      </div>
      <BottomSheet open={choosing !== null} onClose={() => setChoosing(null)} label={t("plans.choosePeriod")}>
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
      </BottomSheet>
    </div>
  );
}
