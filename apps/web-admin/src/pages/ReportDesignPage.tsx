import type { QueryResult, ReportConfig } from "@saiflow/ui";
import { ReportDesigner, type ReportProblem } from "@saiflow/ui/report-designer";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Input, Result, Space, Spin, Typography } from "antd";
import { useCallback, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { ConfirmButton } from "../components/ConfirmButton";
import { ErrorText } from "../components/ErrorText";
import { Page } from "../components/Page";
import { formatTime } from "../format";
import { useSubmit } from "../hooks/useSubmit";
import { useT } from "../i18n";
import { useReportLabels } from "../reports/labels";
import { ApiError } from "../services/errors";
import { idParam, orgKeys, organizations } from "../services/organizations";
import { configOf, reportErrors, reportKeys, reports, sameJson, type ReportDetail } from "../services/reports";
import { useLanguage } from "../stores/language";
import { ReportStatusTag } from "./ReportsPage";
import { GuardedLink, useLeaveWarning } from "./TemplateEditPage";

const MAX_NAME = 120;
const LOCALES = { zh: "zh-CN", en: "en-GB" } as const;

/** Local edits on top of the report as it was at revision `base`. */
interface Edit {
  base: number;
  name: string;
  config: ReportConfig;
}

type Problem = { kind: "conflict" } | { kind: "refused"; n: number } | { kind: "error"; error: unknown };

/** Problems with the configuration they were found for, so later edits mark them stale. */
interface Judged {
  config: ReportConfig;
  errors: ReportProblem[];
}

function Designer({ detail, reload }: { detail: ReportDetail; reload: () => Promise<unknown> }) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const lang = useLanguage((s) => s.lang);
  const labels = useReportLabels();
  const tenantId = detail.tenant_id;
  const listPath = `/reports?tenant=${tenantId}`;
  const org = useQuery({ queryKey: orgKeys.one(tenantId), queryFn: () => organizations.get(tenantId) });
  const catalog = useQuery({
    queryKey: reportKeys.catalog(tenantId, detail.id),
    queryFn: () => reports.templates(tenantId, detail.id),
  });

  const serverConfig = useMemo(() => configOf(detail.draft), [detail.draft]);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [judged, setJudged] = useState<Judged | null>(null);
  const [preview, setPreview] = useState<{ config: ReportConfig; result: QueryResult } | null>(null);

  const value = edit?.config ?? serverConfig;
  const name = edit?.name ?? detail.name;
  const nameOk = name.trim().length > 0 && name.trim().length <= MAX_NAME;
  const dirty = edit !== null && !(edit.name === detail.name && sameJson(edit.config, serverConfig));
  useLeaveWarning(dirty);

  // the stored draft's problems, or those of a refused publication / preview
  const shown: Judged = judged ?? { config: serverConfig, errors: detail.draft_errors };
  const errorsStale = !sameJson(shown.config, value);

  const start = (e: Edit | null): Edit => e ?? { base: detail.revision, name: detail.name, config: serverConfig };
  const landed = (next: ReportDetail) => {
    queryClient.setQueryData(reportKeys.one(detail.id), next);
    void queryClient.invalidateQueries({ queryKey: reportKeys.lists });
  };

  const busy = useSubmit(async (job: () => Promise<void>) => {
    setProblem(null);
    try {
      await job();
    } catch (e) {
      if (e instanceof ApiError && e.code === "revision_conflict") setProblem({ kind: "conflict" });
      else setProblem({ kind: "error", error: e });
    }
  });

  /** Local edits saved first (publication judges the stored draft), else the detail as it is. */
  const stored = async (): Promise<ReportDetail> => {
    if (!dirty || !edit) return detail;
    const next = await reports.save(detail.id, edit.base, edit.name.trim(), edit.config);
    landed(next);
    setEdit(null);
    setJudged(null);
    return next;
  };

  const save = () =>
    busy.run(async () => {
      await stored();
      void message.success(t("rpt.saved"));
    });

  const publish = () =>
    busy.run(async () => {
      const current = await stored();
      try {
        landed(await reports.publish(detail.id, current.revision));
        setJudged(null);
        void message.success(t("rpt.published"));
      } catch (e) {
        const errors = reportErrors(e);
        if (!errors.length) throw e;
        setJudged({ config: configOf(current.draft), errors });
        setProblem({ kind: "refused", n: errors.length });
      }
    });

  const unpublish = () =>
    busy.run(async () => {
      const next = await reports.unpublish(detail.id, detail.revision);
      landed(next);
      // unpublishing bumps the revision; local edits on the same revision follow it
      setEdit((e) => (e && e.base === detail.revision ? { ...e, base: next.revision } : e));
      void message.success(t("rpt.unpublished"));
    });

  const remove = () =>
    busy.run(async () => {
      await reports.remove(detail.id, detail.revision);
      void message.success(t("rpt.deleted"));
      navigate(listPath, { replace: true });
      queryClient.removeQueries({ queryKey: reportKeys.one(detail.id) });
      void queryClient.invalidateQueries({ queryKey: reportKeys.lists });
    });

  // the draft on screen over synthetic rows: no customer data is read
  const runPreview = useSubmit(async () => {
    setProblem(null);
    const config = value;
    try {
      setPreview({ config, result: await reports.preview(detail.id, config) });
    } catch (e) {
      const errors = reportErrors(e);
      if (errors.length) setJudged({ config, errors });
      setProblem({ kind: "error", error: e });
    }
  });

  const loadFields = useCallback(
    (templateId: number, versionIds: number[]) => reports.fields(tenantId, detail.id, templateId, versionIds),
    [tenantId, detail.id],
  );

  const orgName = org.data?.name ? t("rpa.orgOf", { name: org.data.name }) : t("rpa.orgRef", { id: tenantId });

  return (
    <Page
      name="report"
      title={detail.name}
      extra={
        <Space wrap>
          <GuardedLink to={listPath} dirty={dirty}>
            {t("rpt.backToList")}
          </GuardedLink>
          {detail.published && (
            <ConfirmButton label={t("rpt.unpublish")} title={t("rpa.unpublishTitle")} onConfirm={unpublish} />
          )}
          <ConfirmButton
            danger
            label={t("rpt.delete")}
            title={t("rpt.deleteTitle")}
            description={t("rpa.deleteBody")}
            onConfirm={remove}
          />
        </Space>
      }
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Space wrap data-testid="report-meta">
          <ReportStatusTag status={detail.status} />
          <Typography.Text>{orgName}</Typography.Text>
          <Typography.Text type="secondary">
            {detail.published
              ? t("rpt.publishedMeta", { n: detail.published.version, at: formatTime(detail.published.published_at) })
              : t("rpt.notPublished")}{" "}
            · {t("rpt.revision", { n: detail.revision })}
          </Typography.Text>
        </Space>
        {problem?.kind === "conflict" && (
          <Alert
            role="alert"
            type="warning"
            showIcon
            message={t("rpt.conflict")}
            action={
              <ConfirmButton
                label={t("rpt.reload")}
                title={t("rpt.reloadTitle")}
                onConfirm={async () => {
                  await reload();
                  setEdit(null);
                  setJudged(null);
                  setProblem(null);
                }}
              />
            }
          />
        )}
        {problem?.kind === "refused" && (
          <Alert role="alert" type="error" showIcon message={t("rpt.publishRefused", { n: problem.n })} />
        )}
        {problem?.kind === "error" && <ErrorText error={problem.error} />}
        {detail.status === "changed" && (
          <Alert type="info" showIcon message={t("rpa.changedNote", { n: detail.published?.version ?? 0 })} />
        )}
        <section className="ad-panel ad-report-toolbar" aria-label={t("rpt.toolbar")}>
          <label className="ad-report-toolbar__name">
            <span>{t("rpt.name")}</span>
            <Input
              value={name}
              maxLength={MAX_NAME}
              status={nameOk ? undefined : "error"}
              onChange={(e) => {
                const next = e.target.value;
                setEdit((x) => ({ ...start(x), name: next }));
              }}
            />
          </label>
          <Space wrap>
            <Button loading={runPreview.pending} onClick={() => void runPreview.run()}>
              {t("rpt.preview")}
            </Button>
            <Button disabled={!dirty || !nameOk} loading={busy.pending} onClick={() => void save()}>
              {t("rpt.saveDraft")}
            </Button>
            <Button type="primary" disabled={!nameOk} loading={busy.pending} onClick={() => void publish()}>
              {t("rpt.publish")}
            </Button>
          </Space>
          {!nameOk && <Typography.Text type="danger">{t("rpt.nameRequired")}</Typography.Text>}
          <Typography.Text type="secondary" className="ad-report-toolbar__note">
            {t("rpa.previewNote")}
          </Typography.Text>
        </section>
        <ErrorText error={catalog.error} />
        <section className="ad-panel ad-report-designer" aria-label={t("rpt.designer")}>
          <ReportDesigner
            value={value}
            onChange={(next) => setEdit((e) => ({ ...start(e), config: next }))}
            templates={catalog.data ?? []}
            loadFields={loadFields}
            preview={preview?.result ?? null}
            previewLoading={runPreview.pending}
            previewStale={preview !== null && !sameJson(preview.config, value)}
            errors={shown.errors}
            errorsStale={errorsStale}
            lang={lang}
            locale={LOCALES[lang]}
            labels={labels.designer}
            chartLabels={labels.chart}
            gridLabels={labels.grid}
          />
        </section>
      </Space>
    </Page>
  );
}

function DesignLoader({ id }: { id: number }) {
  const t = useT();
  const report = useQuery({ queryKey: reportKeys.one(id), queryFn: () => reports.get(id) });
  if (report.isPending) return <Spin style={{ display: "block", marginTop: 80 }} />;
  if (report.error) {
    if (report.error instanceof ApiError && report.error.status === 404) {
      return <Result status="404" title={t("rpt.notFound")} />;
    }
    return <ErrorText error={report.error} />;
  }
  return <Designer detail={report.data} reload={() => report.refetch()} />;
}

/** /reports/:id: an organization report's draft, synthetic preview, publication (FR-SYS-143). */
export function ReportDesignPage() {
  const t = useT();
  const id = idParam(useParams().id);
  if (id === null) return <Result status="404" title={t("common.notFound")} />;
  return <DesignLoader key={id} id={id} />;
}
