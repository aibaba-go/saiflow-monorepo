import { Card, Spin, Typography } from "antd";

import { ErrorText } from "../components/ErrorText";
import { formatBangkokDate, formatCount } from "../format";
import { useT, type MessageKey } from "../i18n";
import { useUsage } from "./useUsage";

export const planName = (code: string, t: (k: MessageKey) => string): string => t(`plan.${code}` as MessageKey);

/** Plan, validity, this month's scans and the free quota of the current tenant (FR-SYS-094, 053). */
export function UsageCard() {
  const t = useT();
  const usage = useUsage();
  return (
    <Card title={t("usage.title")} data-testid="usage-card" style={{ maxWidth: 520 }}>
      {usage.isPending ? (
        <Spin />
      ) : usage.isError ? (
        <ErrorText error={usage.error} />
      ) : (
        <UsageBody usage={usage.data} />
      )}
    </Card>
  );
}

type Usage = NonNullable<ReturnType<typeof useUsage>["data"]>;

function UsageBody({ usage }: { usage: Usage }) {
  const t = useT();
  const { plan, active, month, free } = usage;
  const freeText = [
    t("usage.free", { n: formatCount(free.remaining) }),
    free.paused ? t("usage.paused") : null,
    free.expires_at ? t("usage.freeExpires", { date: formatBangkokDate(free.expires_at) }) : null,
  ]
    .filter(Boolean)
    .join(" · ");
  return (
    <>
      <Typography.Title level={4} style={{ margin: 0 }}>
        {plan ? planName(plan.code, t) : t("usage.noPlan")}
      </Typography.Title>
      {plan && (
        <Typography.Text type="secondary">
          {active
            ? t("usage.validUntil", { date: formatBangkokDate(plan.ends_at) })
            : t("usage.expiredOn", { date: formatBangkokDate(plan.ends_at) })}
        </Typography.Text>
      )}
      <Typography.Title level={2} style={{ margin: "16px 0 0" }}>
        {`${formatCount(month.remaining)} / ${formatCount(month.quota)}`}
      </Typography.Title>
      <Typography.Text type="secondary">{t("usage.remainingHint")}</Typography.Text>
      <Typography.Paragraph style={{ marginTop: 16, marginBottom: 0 }}>{freeText}</Typography.Paragraph>
    </>
  );
}
