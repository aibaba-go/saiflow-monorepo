import { Card } from "antd-mobile";

import { BrandLoading } from "../../components/BrandLoading";
import { ErrorText } from "../../components/ErrorText";
import { useT, type MessageKey } from "../../i18n";
import { formatBangkokDate, formatCount } from "../../utils/format";
import { useCurrentTenant } from "../tenants/useCurrentTenant";
import { useUsage } from "./useUsage";

export const planName = (code: string, t: (k: MessageKey) => string): string =>
  t(`plan.${code}` as MessageKey);

/** Plan, validity, this month's scans and the free quota of the current tenant (FR-SYS-053). */
export function UsageCard() {
  const t = useT();
  const { tenant } = useCurrentTenant();
  const usage = useUsage();
  if (usage.isPending) return <BrandLoading variant="inline" label={t("common.loading")} />;
  if (usage.isError) return <ErrorText error={usage.error} />;
  const { plan, active, month, free } = usage.data;
  return (
    <Card title={t("usage.title")}>
      <div className="usage__plan">
        {plan ? planName(plan.code, t) : t("usage.noPlan")}
        {plan && (
          <span className="usage__validity">
            {" · "}
            {active
              ? t("usage.validUntil", { date: formatBangkokDate(plan.ends_at) })
              : t("usage.expiredOn", { date: formatBangkokDate(plan.ends_at) })}
          </span>
        )}
      </div>
      <div className="usage__count">
        {formatCount(month.remaining)} / {formatCount(month.quota)}
      </div>
      <div className="usage__hint">{t("usage.remainingHint")}</div>
      {tenant?.kind !== "guest" && (
        <div className="usage__free">
          {t("usage.free", { n: formatCount(free.remaining) })}
          {free.paused && ` · ${t("usage.paused")}`}
          {free.expires_at && ` · ${t("usage.freeExpires", { date: formatBangkokDate(free.expires_at) })}`}
        </div>
      )}
    </Card>
  );
}
