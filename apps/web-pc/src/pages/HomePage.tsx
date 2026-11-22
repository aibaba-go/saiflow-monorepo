import { Alert, Button, Empty, Spin } from "antd";
import { Link, useNavigate } from "react-router-dom";

import { useIdentity, useMe } from "../auth/session";
import { useHomepage } from "../reports/api";
import { errorMessage } from "../services/errors";
import { HomepageReport } from "./ReportViewPage";
import { SystemDashboard } from "./SystemDashboard";
import { UsageCard } from "../billing/UsageCard";
import { Page, TodayLabel } from "../components/Page";
import { useT, type MessageKey } from "../i18n";
import { Icon, type IconName } from "../layout/icons";
import { useJobs, useStageCounts } from "../ocr/api";
import { JobTable } from "../ocr/JobTable";
import { canEditJob } from "../ocr/stage";
import { can } from "../tenants/permissions";
import { useTenant } from "../tenants/useTenant";

/** The three steps every document goes through; product description, not data. */
const FLOW: { icon: IconName; label: MessageKey; sub: MessageKey }[] = [
  { icon: "file", label: "brand.flowSource", sub: "brand.flowSourceSub" },
  { icon: "spark", label: "brand.flowExtract", sub: "brand.flowExtractSub" },
  { icon: "review", label: "brand.flowVerify", sub: "brand.flowVerifySub" },
];

/** The metric strip: real per-stage totals of the library list, each opening the library on
 * that stage. */
const METRICS: { stage: string; icon: IconName }[] = [
  { stage: "VERIFYING", icon: "verify" },
  { stage: "OCR_PROCESSING", icon: "clock" },
  { stage: "PENDING_REVIEW", icon: "review" },
  { stage: "CONFIRMED", icon: "check" },
];
const METRIC_STAGES = METRICS.map((m) => m.stage);

const PROCESS: { icon: IconName; label: MessageKey }[] = [
  { icon: "upload", label: "process.upload" },
  { icon: "spark", label: "process.extract" },
  { icon: "verify", label: "process.verify" },
  { icon: "check", label: "process.confirm" },
];

/** The process line under a task table (product description, not data). */
export function MiniProcess() {
  const t = useT();
  return (
    <ol className="pc-mini-process" aria-label={t("process.title")}>
      {PROCESS.map((p) => (
        <li key={p.label}>
          <Icon name={p.icon} />
          {t(p.label)}
        </li>
      ))}
    </ol>
  );
}

function MetricStrip() {
  const t = useT();
  const counts = useStageCounts(METRIC_STAGES);
  const failed = counts.find((c) => c.isError);
  if (failed) return null;
  if (counts.some((c) => c.data === undefined)) return null;
  return (
    <nav className="pc-metrics" aria-label={t("home.metrics")} data-testid="metric-strip">
      {METRICS.map((m, i) => (
        <Link key={m.stage} to={`/library?stage=${m.stage}`} className="pc-metric" data-stage={m.stage}>
          <span className="pc-metric__symbol">
            <Icon name={m.icon} />
          </span>
          <span className="pc-metric__text">
            <span className="pc-metric__number num">{counts[i]!.data}</span>
            <span className="pc-metric__label">{t(`home.metric.${m.stage}` as MessageKey)}</span>
          </span>
          <Icon name="chevron" className="pc-metric__end" />
        </Link>
      ))}
    </nav>
  );
}

/** Home (FR-SYS-094): the current tenant's usage and the way to the plans; the number of
 * tasks to verify; per-stage totals; the latest five tasks, or the way to Upload when there
 * are none. The brand hero only describes the process; every number comes from the API. */
export function HomeRoute() {
  const me = useIdentity();
  const { tenant } = useTenant();
  return me.data?.kind === "user"
    ? <SignedInHome key={`${me.data.user_id}:${tenant?.tenant_id}`} />
    : <HomePage />;
}

function SignedInHome() {
  const t = useT();
  const preference = useHomepage();
  if (preference.isPending) return <Spin />;
  if (preference.error) return <Alert role="alert" type="error" showIcon message={t("rpt.loadFailed")}
    description={errorMessage(preference.error, t)} action={<Button onClick={() => void preference.refetch()}>{t("common.retry")}</Button>} />;
  const fallback = <SystemDashboard />;
  return preference.data.report_id === null
    ? fallback
    : <HomepageReport id={preference.data.report_id} fallback={fallback} />;
}

export function HomePage() {
  const t = useT();
  const navigate = useNavigate();
  const { tenant } = useTenant();
  const me = useMe();
  const canVerify = can(tenant, "verify_own") || can(tenant, "verify_others");
  const canUpload = can(tenant, "upload_ocr");
  // only the jobs this user may verify (minor-fixes-ui)
  const toVerify = useJobs({ page: 1, pageSize: 100, stage: "VERIFYING" });
  const verifiable = (toVerify.data?.items ?? []).filter((j) => canEditJob(j, tenant, me.data?.user_id)).length;
  const recent = useJobs({ page: 1, pageSize: 5 });
  const rows = recent.data?.items ?? [];
  return (
    <Page
      name="home"
      title={t("nav.home")}
      description={t("layout.desc.home")}
      meta={<TodayLabel />}
      extra={
        canUpload && (
          <Button type="primary" icon={<Icon name="plus" />} onClick={() => navigate("/upload")}>
            {t("home.uploadCta")}
          </Button>
        )
      }
    >
      <div className="pc-home">
        <div className="pc-home__top">
          <section className="pc-hero" aria-labelledby="pc-hero-title">
            <div className="pc-hero__copy">
              <p className="pc-hero__eyebrow">
                <Icon name="spark" />
                {t("brand.heroEyebrow")}
              </p>
              <h2 id="pc-hero-title" className="pc-hero__title">
                {t("brand.heroTitle")}<br /><span className="pc-hero__accent">{t("brand.heroTitleAccent")}</span>
              </h2>
              <p className="pc-hero__body">{t("brand.heroBody")}</p>
              {canVerify && (
                <div data-testid="to-verify" className="pc-hero__cta">
                  <Link to="/verify" className="pc-hero__link">
                    <span className="pc-hero__arrow">
                      <Icon name="arrow" />
                    </span>
                    <span>{t("home.toVerifyCta")}</span>
                    {toVerify.isPending ? (
                      <Spin size="small" />
                    ) : (
                      <span className="pc-hero__count num">({verifiable})</span>
                    )}
                  </Link>
                </div>
              )}
              <ul className="pc-hero__trust">
                <li>
                  <Icon name="file" />
                  {t("brand.trustOriginal")}
                </li>
                <li>
                  <Icon name="verify" />
                  {t("brand.trustVerified")}
                </li>
                <li>
                  <Icon name="history" />
                  {t("brand.trustTraceable")}
                </li>
              </ul>
            </div>
            <div className="pc-flow">
              <p className="pc-flow__kicker">{t("brand.flowKicker")}</p>
              <ol className="pc-flow__list" aria-label={t("brand.flowTitle")}>
                {FLOW.map((step, i) => (
                  <li key={step.label} className={`pc-flow__node${i === FLOW.length - 1 ? " pc-flow__node--last" : ""}`}>
                    <b className="num" aria-hidden="true">
                      {String(i + 1).padStart(2, "0")}
                    </b>
                    <span className="pc-flow__symbol">
                      <Icon name={step.icon} />
                    </span>
                    <span className="pc-flow__text">
                      <strong>{t(step.label)}</strong>
                      <small>{t(step.sub)}</small>
                    </span>
                  </li>
                ))}
              </ol>
            </div>
          </section>
          <UsageCard plansLink />
        </div>
        <MetricStrip />
        <section className="pc-panel pc-panel--table">
          <div className="pc-panel__heading">
            <div>
              <h2>{t("home.recent")}</h2>
              <p className="pc-panel__sub">{t("home.recentSub")}</p>
            </div>
            <Link to="/library" className="pc-text-link">
              {t("home.viewAll")}
              <Icon name="arrow" />
            </Link>
          </div>
          {!recent.isPending && !rows.length ? (
            <Empty className="pc-panel__empty" description={t("home.noTasks")}>
              {canUpload && (
                <Button type="primary" onClick={() => navigate("/upload")}>
                  {t("nav.upload")}
                </Button>
              )}
            </Empty>
          ) : (
            <JobTable testId="recent-tasks" rows={rows} loading={recent.isPending} />
          )}
          <div className="pc-panel__footer">
            <span>{rows.length > 0 ? t("home.recentCount", { n: rows.length }) : null}</span>
            <MiniProcess />
          </div>
        </section>
      </div>
    </Page>
  );
}
