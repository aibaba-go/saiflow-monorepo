import { Button, Card, Spin } from "antd";
import { Link } from "react-router-dom";

import { ErrorText } from "../components/ErrorText";
import { formatBangkokDate, formatCount } from "../format";
import { useT, type MessageKey } from "../i18n";
import { Icon } from "../layout/icons";
import { useUsage } from "./useUsage";

export const planName = (code: string, t: (k: MessageKey) => string): string => t(`plan.${code}` as MessageKey);

const percent = (n: number) => new Intl.NumberFormat("en-US", { maximumFractionDigits: 2 }).format(n);

/** Plan, validity, this month's scans and the free quota of the current tenant (FR-SYS-094, 053).
 * Every number is from GET /billing/usage; `plansLink` adds the way to the plans (home). */
export function UsageCard({ plansLink = false, retry = false }: { plansLink?: boolean; retry?: boolean }) {
  const t = useT();
  const usage = useUsage();
  return (
    <Card data-testid="usage-card" className="pc-usage">
      {usage.isPending ? (
        <Spin />
      ) : usage.isError ? (
        <><ErrorText error={usage.error} />{retry && <Button onClick={() => void usage.refetch()}>{t("common.retry")}</Button>}</>
      ) : (
        <UsageBody usage={usage.data} plansLink={plansLink} />
      )}
    </Card>
  );
}

type Usage = NonNullable<ReturnType<typeof useUsage>["data"]>;

function UsageBody({ usage, plansLink }: { usage: Usage; plansLink: boolean }) {
  const t = useT();
  const { plan, active, month, free } = usage;
  const freeText = [t("usage.free", { n: formatCount(free.remaining) }), free.paused ? t("usage.paused") : null]
    .filter(Boolean)
    .join(" · ");
  // The share of this month's quota already used, from the same numbers shown with it.
  const used = month.quota > 0 ? Math.min(100, Math.max(0, (month.used / month.quota) * 100)) : null;
  return (
    <div className="pc-usage__body">
      <div className="pc-usage__head">
        <span className="pc-usage__eyebrow">{t("usage.title")}</span>
        <span className="pc-usage__plan">{plan ? planName(plan.code, t) : t("usage.noPlan")}</span>
      </div>
      <div className="pc-usage__number num">
        {formatCount(month.used)} <span>{t("usage.ofQuota", { n: formatCount(month.quota) })}</span>
      </div>
      {used !== null ? (
        <div
          className="pc-usage__bar"
          role="meter"
          aria-label={t("usage.title")}
          aria-valuemin={0}
          aria-valuemax={month.quota}
          aria-valuenow={month.used}
        >
          <span style={{ width: `${used}%` }} />
        </div>
      ) : (
        <div className="pc-usage__bar" aria-hidden="true" />
      )}
      <div className="pc-usage__meta">
        <span>{used !== null ? t("usage.usedPct", { pct: percent(used) }) : t("usage.remainingHint")}</span>
        <span className="pc-usage__left num">{t("usage.left", { n: formatCount(month.remaining) })}</span>
      </div>
      <div className="pc-usage__bottom">
        <span>{freeText}</span>
        {free.expires_at && <span>{t("usage.freeExpires", { date: formatBangkokDate(free.expires_at) })}</span>}
      </div>
      {(plan || plansLink) && (
        <div className="pc-usage__expiry">
          <span>
            {plan &&
              (active
                ? t("usage.validUntil", { date: formatBangkokDate(plan.ends_at) })
                : t("usage.expiredOn", { date: formatBangkokDate(plan.ends_at) }))}
          </span>
          {plansLink && (
            <Link to="/plans" className="pc-text-link">
              {t("usage.planDetails")}
              <Icon name="arrow" />
            </Link>
          )}
        </div>
      )}
    </div>
  );
}
