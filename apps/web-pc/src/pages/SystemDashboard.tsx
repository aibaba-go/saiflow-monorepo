import { Alert, Button, Empty, Spin, Table } from "antd";
import { Link, useNavigate } from "react-router-dom";

import { Page } from "../components/Page";
import { formatBangkokDate, formatBangkokDateTime, formatCount } from "../format";
import { useT, type MessageKey } from "../i18n";
import { Icon, type IconName } from "../layout/icons";
import { configOf, useDashboard } from "../reports/api";
import { errorMessage } from "../services/errors";
import { can } from "../tenants/permissions";
import { useTenant } from "../tenants/useTenant";
import { planName } from "../billing/UsageCard";

const SYMBOLS: Record<string, IconName> = { VERIFYING: "verify", OCR_PROCESSING: "clock", PENDING_REVIEW: "review", CONFIRMED: "check" };

export function SystemDashboard() {
  const t = useT();
  const navigate = useNavigate();
  const { tenant } = useTenant();
  const dashboard = useDashboard();
  if (dashboard.error) return <Alert role="alert" type="error" showIcon message={t("rpt.loadFailed")} description={errorMessage(dashboard.error, t)} action={<Button onClick={() => void dashboard.refetch()}>{t("common.retry")}</Button>} />;
  if (!dashboard.data) return <Spin />;
  const { kind, counts, usage, recent } = dashboard.data;
  const config = configOf(dashboard.data.config);
  const metrics = config.cards.filter((c) => SYMBOLS[c.id]);
  const progressCard = config.cards.find((c) => c.id === "progress")!;
  const total = metrics.reduce((n, c) => n + (counts[c.id] ?? 0), 0);
  return <Page name="home" title="" hideHeading>
    <section className="pc-home pc-system-dashboard" data-home-default={kind} aria-label={t(kind === "personal" ? "rpt.personalHome" : "rpt.organizationHome")}>
      <nav className="pc-metrics" aria-label={t("home.metrics")} data-testid="metric-strip">
        {metrics.map((c) => <Link key={c.id} to={`/library?stage=${c.id}`} className="pc-metric" data-stage={c.id}>
          <span className="pc-metric__symbol"><Icon name={SYMBOLS[c.id]!} /></span>
          <span className="pc-metric__text"><span className="pc-metric__number num">{formatCount(counts[c.id]!)}</span><span className="pc-metric__label">{t(`home.metric.${c.id}` as MessageKey)}</span></span>
          <Icon name="chevron" className="pc-metric__end" />
        </Link>)}
      </nav>
      <div className="pc-system-dashboard__body" style={{ gridTemplateColumns: `minmax(0, ${progressCard.layout.w}fr) minmax(0, ${12 - progressCard.layout.w}fr)` }}>
        <section className="pc-panel pc-progress" data-testid="progress-card">
          <div className="pc-panel__heading"><h2>{t("home.metrics")}</h2></div>
          <div className="pc-progress__body">{metrics.map(c => <div key={c.id} className="pc-progress__row" data-stage={c.id}>
            <div className="pc-progress__label"><span>{t(`home.metric.${c.id}` as MessageKey)}</span><strong className="num">{formatCount(counts[c.id]!)}</strong></div>
            <div className="pc-progress__track" role="progressbar" aria-label={t(`home.metric.${c.id}` as MessageKey)} aria-valuemin={0} aria-valuemax={Math.max(total, 1)} aria-valuenow={counts[c.id] ?? 0}><span style={{ width: `${total ? (counts[c.id] ?? 0) / total * 100 : 0}%` }} /></div>
          </div>)}</div>
        </section>
        <section className="pc-panel pc-usage" data-testid="usage-card">
          <div className="pc-panel__heading"><h2>{t("usage.title")}</h2><span className="pc-usage__plan">{usage.plan_code ? planName(usage.plan_code, t) : t("usage.noPlan")}</span></div>
          <div className="pc-usage__body">
            <div className="pc-usage__number num">{formatCount(usage.used)} <span>{t("usage.ofQuota", { n: formatCount(usage.quota) })}</span></div>
            <div className="pc-usage__bar" role="meter" aria-label={t("usage.title")} aria-valuemin={0} aria-valuemax={usage.quota} aria-valuenow={usage.used}>
              <span style={{ width: `${usage.quota ? Math.min(100, usage.used / usage.quota * 100) : 0}%` }} />
            </div>
            <div className="pc-usage__meta"><span>{t("usage.left", { n: formatCount(usage.remaining) })}</span></div>
            <div className="pc-usage__bottom"><span>{t("usage.free", { n: formatCount(usage.free_remaining) })}{usage.free_paused && ` · ${t("usage.paused")}`}</span>
              {usage.free_expires_at && <span>{t("usage.freeExpires", { date: formatBangkokDate(usage.free_expires_at) })}</span>}
            </div>
            {usage.ends_at && <div className="pc-usage__expiry">{t(usage.plan_active ? "usage.validUntil" : "usage.expiredOn", { date: formatBangkokDate(usage.ends_at) })}</div>}
          </div>
        </section>
      </div>
        <section className="pc-panel pc-panel--table">
          <div className="pc-panel__heading"><h2>{t("home.recent")}</h2><Link to="/library" className="pc-text-link">{t("home.viewAll")}<Icon name="arrow" /></Link></div>
          {recent.length ? <Table data-testid="recent-tasks" rowKey="id" dataSource={recent} pagination={false} tableLayout="fixed" scroll={{ x: 640 }} columns={[
            { key: "file", title: t("table.file"), width: "50%", ellipsis: true, render: (_, row) => <Link to={`/documents/${row.id}`} title={row.original_name}>{row.original_name}</Link> },
            { key: "stage", title: t("table.stage"), width: "22%", render: (_, row) => <span className="pc-system-dashboard__stage" data-stage={row.stage}>{t(`stage.${row.stage}` as MessageKey)}</span> },
            { key: "at", title: t("table.created"), width: "28%", render: (_, row) => <span className="pc-system-dashboard__date num">{formatBangkokDateTime(row.created_at)}</span> },
          ]} /> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description={t("home.noTasks")}>
            {can(tenant, "upload_ocr") && <Button type="primary" icon={<Icon name="upload" />} onClick={() => navigate("/upload")}>{t("nav.upload")}</Button>}
          </Empty>}
        </section>
    </section>
  </Page>;
}
