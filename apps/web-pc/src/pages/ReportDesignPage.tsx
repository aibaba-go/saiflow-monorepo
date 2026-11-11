import type { QueryResult, ReportConfig } from "@saiflow/ui";
import { ReportDesigner, type ReportProblem } from "@saiflow/ui/report-designer";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Input, Result, Space, Spin, Typography } from "antd";
import { useCallback, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { ConfirmButton } from "../components/ConfirmButton";
import { ErrorText } from "../components/ErrorText";
import { Page } from "../components/Page";
import { formatBangkokDateTime } from "../format";
import { useSubmit } from "../hooks/useSubmit";
import { useT } from "../i18n";
import {
  catalogFields,
  configOf,
  deleteReport,
  previewReport,
  publishReport,
  reportErrors,
  saveReport,
  unpublishReport,
  useCatalog,
  useReport,
  type ReportDetail,
} from "../reports/api";
import { ReportGate, ReportStatusTag, useReportAccess } from "../reports/common";
import { useReportLabels } from "../reports/labels";
import { ApiError } from "../services/errors";
import { useLanguage } from "../stores/language";
import { sameJson } from "../templates/api";
import { useLeaveGuard } from "../templates/common";
import { useTenant } from "../tenants/useTenant";

const MAX_NAME = 120;

/** Local edits on top of the report as it was at revision `base`. */
interface Edit {
  base: number;
  name: string;
  config: ReportConfig;
}

type Problem = { kind: "conflict" } | { kind: "refused"; n: number } | { kind: "error"; error: unknown };

/** Problems with the configuration they were found for, so edits made later mark them stale. */
interface Judged {
  config: ReportConfig;
  errors: ReportProblem[];
}

function Designer({ detail, reload }: { detail: ReportDetail; reload: () => Promise<unknown> }) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const { tenant } = useTenant();
  const { access } = useReportAccess();
  const lang = useLanguage((s) => s.lang);
  const labels = useReportLabels();
  const key = ["report", tenant?.tenant_id, detail.id];
  const catalog = useCatalog(detail.id, true);

  const serverConfig = useMemo(() => configOf(detail.draft), [detail.draft]);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [judged, setJudged] = useState<Judged | null>(null);
  const [preview, setPreview] = useState<{ config: ReportConfig; result: QueryResult } | null>(null);

  const value = edit?.config ?? serverConfig;
  const name = edit?.name ?? detail.name;
  const nameOk = name.trim().length > 0 && name.trim().length <= MAX_NAME;
  const dirty = edit !== null && !(edit.name === detail.name && sameJson(edit.config, serverConfig));
  const { leave, guard } = useLeaveGuard(dirty, "rpt.leaveBody");

  // the stored draft's problems, or those of a refused publication / preview (FR-REPORT-014)
  const shown: Judged = judged ?? { config: serverConfig, errors: detail.draft_errors };
  const errorsStale = !sameJson(shown.config, value);

  const start = (e: Edit | null): Edit => e ?? { base: detail.revision, name: detail.name, config: serverConfig };
  const landed = (next: ReportDetail) => {
    queryClient.setQueryData(key, next);
    void queryClient.invalidateQueries({ queryKey: ["reports"] });
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

  /** Local edits saved first (publish judges the stored draft), else the detail as it is. */
  const stored = async (): Promise<ReportDetail> => {
    if (!dirty || !edit) return detail;
    const next = await saveReport(detail.id, edit.base, edit.name.trim(), edit.config);
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
        landed(await publishReport(detail.id, current.revision));
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
      const next = await unpublishReport(detail.id, detail.revision);
      landed(next);
      // unpublishing bumps the revision; local edits on the same revision follow it
      setEdit((e) => (e && e.base === detail.revision ? { ...e, base: next.revision } : e));
      void message.success(t("rpt.unpublished"));
    });

  const remove = () =>
    busy.run(async () => {
      await deleteReport(detail.id, detail.revision);
      void message.success(t("rpt.deleted"));
      leave(() => navigate("/reports", { replace: true }));
      queryClient.removeQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: ["reports"] });
    });

  // the draft on screen, on the designer's own data scope (FR-REPORT-005)
  const runPreview = useSubmit(async () => {
    setProblem(null);
    const config = value;
    try {
      setPreview({ config, result: await previewReport(detail.id, config, null) });
    } catch (e) {
      const errors = reportErrors(e);
      if (errors.length) setJudged({ config, errors });
      setProblem({ kind: "error", error: e });
    }
  });

  const loadFields = useCallback(
    (templateId: number, versionIds: number[]) => catalogFields(detail.id, templateId, versionIds),
    [detail.id],
  );

  return (
    <Page
      name="reports"
      title={detail.name}
      badge={<ReportStatusTag status={detail.status} />}
      meta={
        <span>
          {detail.published
            ? t("rpt.publishedMeta", { n: detail.published.version, at: formatBangkokDateTime(detail.published.published_at) })
            : t("rpt.notPublished")}{" "}
          · {t("rpt.revision", { n: detail.revision })}
        </span>
      }
      extra={
        <Space wrap>
          {detail.published && access.view && (
            <Button
              disabled={dirty}
              title={dirty ? t("rpt.saveFirst") : undefined}
              onClick={() => navigate(`/reports/${detail.id}`)}
            >
              {t("rpt.openPublished")}
            </Button>
          )}
          {detail.published && <ConfirmButton label={t("rpt.unpublish")} title={t("rpt.unpublishTitle")} onConfirm={unpublish} />}
          <ConfirmButton danger label={t("rpt.delete")} title={t("rpt.deleteTitle")} description={t("rpt.deleteBody")} onConfirm={remove} />
        </Space>
      }
    >
      {problem?.kind === "conflict" && (
        <Alert
          role="alert"
          type="warning"
          showIcon
          message={t("rpt.conflict")}
          action={
            <ConfirmButton
              size="small"
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
      {problem?.kind === "refused" && <Alert role="alert" type="error" showIcon message={t("rpt.publishRefused", { n: problem.n })} />}
      {problem?.kind === "error" && <ErrorText error={problem.error} />}
      {detail.status === "changed" && <Alert type="info" showIcon message={t("rpt.changedNote", { n: detail.published?.version ?? 0 })} />}
      <section className="pc-panel pc-report-toolbar" aria-label={t("rpt.toolbar")}>
        <label className="pc-report-toolbar__name">
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
        <Typography.Text type="secondary" className="pc-report-toolbar__note">
          {t("rpt.previewNote")}
        </Typography.Text>
      </section>
      <ErrorText error={catalog.error} />
      <section className="pc-panel" aria-label={t("rpt.designer")}>
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
          locale={t("format.locale")}
          labels={labels.designer}
          chartLabels={labels.chart}
          gridLabels={labels.grid}
        />
      </section>
      {guard}
    </Page>
  );
}

function DesignLoader() {
  const t = useT();
  const id = Number(useParams().id);
  const report = useReport(id);
  if (report.isPending) return <Spin />;
  if (report.error) {
    if (report.error instanceof ApiError && report.error.status === 404) return <Result status="404" title={t("rpt.notFound")} />;
    return <ErrorText error={report.error} />;
  }
  if (!report.data.can_manage) return <Result status="403" title={t("rpt.noAccess")} subTitle={t("rpt.noManage")} />;
  return <Designer detail={report.data} reload={() => report.refetch()} />;
}

/** /reports/:id/design: the draft of one report, with save, preview, publish (FR-REPORT-014,
 * FR-SYS-141). */
export function ReportDesignPage() {
  return (
    <ReportGate need="manage">
      <DesignLoader />
    </ReportGate>
  );
}
