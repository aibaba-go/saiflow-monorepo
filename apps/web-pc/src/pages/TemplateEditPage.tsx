import {
  TemplateEditor,
  validateTemplateClient,
  type PendingConfirmation,
  type TemplateContent,
  type TemplatePathError,
} from "@saiflow/ui/template-editor";
import { useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, List, Modal, Result, Space, Spin, Tag, Tooltip, Typography } from "antd";
import { useMemo, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";

import { ConfirmButton } from "../components/ConfirmButton";
import { ErrorText } from "../components/ErrorText";
import { Page } from "../components/Page";
import { formatBangkokDateTime } from "../format";
import { useSubmit } from "../hooks/useSubmit";
import { useT, type MessageKey } from "../i18n";
import { ApiError, errorMessage } from "../services/errors";
import {
  activate,
  BLANK,
  contentOf,
  createTemplate,
  deleteTemplate,
  discardDraft,
  downloadJson,
  exportTemplate,
  pathErrors,
  pendingIn,
  remapPending,
  sameJson,
  saveDraft,
  setStatus,
  useTemplate,
  useVersion,
  versionContent,
  type Source,
  type TemplateDetail,
} from "../templates/api";
import { ProblemAlert, problemOf, ScopeTag, StatusTag, TemplateGate, useLeaveGuard, type Problem } from "../templates/common";
import { useEditorLabels } from "../templates/labels";
import { useTenant } from "../tenants/useTenant";

/** The errors shown in the editor: the client check of what is on screen, plus the server's
 * judgement of an activation while the content is still the one it judged. */
function shownErrors(value: TemplateContent, server: { content: TemplateContent; errors: TemplatePathError[] } | null) {
  const live = validateTemplateClient(value);
  if (!server || !sameJson(server.content, value)) return live;
  const seen = new Set(server.errors.map((e) => `${e.path}\n${e.message}`));
  return [...server.errors, ...live.filter((e) => !seen.has(`${e.path}\n${e.message}`))];
}

/** A taken code is marked on the Code input until it is changed (FR-TEMPLATE-011). */
function withTakenCode(errors: TemplatePathError[], value: TemplateContent, problem: Problem | null, message: string) {
  return problem?.kind === "code" && problem.code === value.code ? [{ path: "code", message }, ...errors] : errors;
}

function NewTemplate() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const { tenant } = useTenant();
  const labels = useEditorLabels();
  const state = useLocation().state as { content?: TemplateContent; source?: Source } | null;
  const source: Source = state?.source === "import" ? "import" : "manual";
  const [value, setValue] = useState<TemplateContent>(() => state?.content ?? BLANK);
  const [problem, setProblem] = useState<Problem | null>(null);
  // an imported file is not saved yet, so leaving loses it
  const dirty = source === "import" || !sameJson(value, BLANK);
  const { leave, guard } = useLeaveGuard(dirty);
  // an untouched blank form says nothing yet; problems appear once it is edited or saved
  const [tried, setTried] = useState(false);
  const errors = useMemo(
    () => withTakenCode(dirty || tried ? validateTemplateClient(value) : [], value, problem, t("tpl.codeTaken")),
    [dirty, tried, value, problem, t],
  );

  // FR-TEMPLATE-001/011: saved as a draft only; a taken code keeps everything on screen.
  const save = useSubmit(async () => {
    setTried(true);
    setProblem(null);
    try {
      const created = await createTemplate(value, source);
      queryClient.setQueryData(["managed-template", tenant?.tenant_id, created.id], created);
      void queryClient.invalidateQueries({ queryKey: ["managed-templates"] });
      void message.success(t("tpl.created"));
      leave(() => navigate(`/templates/${created.id}`, { replace: true }));
    } catch (e) {
      setProblem(problemOf(e, value));
    }
  });

  return (
    <Page
      name="templates"
      title={t("tpl.newTitle")}
      extra={
        <Button type="primary" loading={save.pending} onClick={() => void save.run()}>
          {t("tpl.save")}
        </Button>
      }
    >
      <ProblemAlert problem={problem} />
      <section className="pc-panel" aria-label={t("tpl.newTitle")}>
        <TemplateEditor value={value} onChange={setValue} errors={errors} labels={labels} />
      </section>
      {guard}
    </Page>
  );
}

/** /templates/new: a blank template, or the content of an imported JSON file. */
export function TemplateNewPage() {
  return (
    <TemplateGate>
      <NewTemplate />
    </TemplateGate>
  );
}

/** Local edits on top of the template as it was at revision `base`. */
interface Edit {
  base: number;
  content: TemplateContent;
  pending: PendingConfirmation[];
}

function VersionModal({ detail, versionId, onClose }: { detail: TemplateDetail; versionId: number | null; onClose: () => void }) {
  const t = useT();
  const labels = useEditorLabels();
  const version = useVersion(detail.id, versionId);
  const n = detail.versions.find((v) => v.id === versionId)?.version ?? 0;
  return (
    <Modal open={versionId !== null} title={t("tpl.versionTitle", { n })} footer={null} width={960} onCancel={onClose} destroyOnHidden>
      <ErrorText error={version.error} />
      {version.isPending ? (
        <Spin />
      ) : (
        version.data && <TemplateEditor value={versionContent(detail.code, version.data)} readOnly labels={labels} />
      )}
    </Modal>
  );
}

function Detail({ detail, reload }: { detail: TemplateDetail; reload: () => Promise<unknown> }) {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { message } = App.useApp();
  const { tenant } = useTenant();
  const labels = useEditorLabels();
  const key = ["managed-template", tenant?.tenant_id, detail.id];

  const serverContent = useMemo(() => contentOf(detail), [detail]);
  const serverPending = useMemo(() => pendingIn(detail.pending_confirmations), [detail]);
  const [edit, setEdit] = useState<Edit | null>(null);
  const [epoch, setEpoch] = useState(0);
  const [problem, setProblem] = useState<Problem | null>(null);
  const [judged, setJudged] = useState<{ content: TemplateContent; errors: TemplatePathError[] } | null>(null);
  const [versionId, setVersionId] = useState<number | null>(null);

  const manage = detail.can_manage;
  const value = manage ? (edit?.content ?? serverContent) : detail.current ? versionContent(detail.code, detail.current) : serverContent;
  const pending = edit?.pending ?? serverPending;
  const dirty = edit !== null && !(sameJson(edit.content, serverContent) && sameJson(edit.pending, serverPending));
  const { leave, guard } = useLeaveGuard(dirty);
  const errors = useMemo(
    () => (manage ? withTakenCode(shownErrors(value, judged), value, problem, t("tpl.codeTaken")) : []),
    [manage, value, judged, problem, t],
  );

  const start = (e: Edit | null): Edit => e ?? { base: detail.revision, content: serverContent, pending: serverPending };
  const landed = (next: TemplateDetail) => {
    queryClient.setQueryData(key, next);
    void queryClient.invalidateQueries({ queryKey: ["managed-templates"] });
  };
  const restart = () => {
    setEdit(null);
    setEpoch((n) => n + 1);
  };

  // One action at a time; each explains its own refusal (FR-TEMPLATE-005/009/010).
  const busy = useSubmit(async (job: () => Promise<void>) => {
    setProblem(null);
    try {
      await job();
    } catch (e) {
      setProblem(problemOf(e, value));
      if (e instanceof ApiError && e.code === "template_in_use") void reload();
    }
  });

  const save = () =>
    busy.run(async () => {
      if (!edit) return;
      landed(await saveDraft(detail.id, edit.base, edit.content, edit.pending));
      setEdit(null);
      void message.success(t("tpl.saved"));
    });

  // Activation judges the stored draft, so local edits are saved first (D2).
  const doActivate = () =>
    busy.run(async () => {
      let stored = detail;
      if (dirty && edit) {
        stored = await saveDraft(detail.id, edit.base, edit.content, edit.pending);
        landed(stored);
        setEdit(null);
      }
      try {
        const out = await activate(detail.id, stored.revision);
        landed(out.template);
        setJudged(null);
        void message.success(t(out.result === "activated" ? "tpl.activated" : "tpl.unchanged", { n: out.version.version }));
      } catch (e) {
        // the server's path errors stay on the content it judged (AC-FR-TEMPLATE-005)
        setJudged({ content: contentOf(stored), errors: pathErrors(e) });
        throw e;
      }
    });

  const discard = async () => {
    if (!detail.has_draft) return restart();
    await busy.run(async () => {
      landed(await discardDraft(detail.id, detail.revision));
      restart();
      void message.success(t("tpl.discarded"));
    });
  };

  const toggle = () =>
    busy.run(async () => {
      const next = await setStatus(detail.id, detail.revision, detail.status === "ENABLED" ? "DISABLED" : "ENABLED");
      landed(next);
      // the status bumps the revision; local edits made on the same revision follow it
      setEdit((e) => (e && e.base === detail.revision ? { ...e, base: next.revision } : e));
      void message.success(t(next.status === "ENABLED" ? "tpl.enabled" : "tpl.disabled"));
    });

  const remove = () =>
    busy.run(async () => {
      await deleteTemplate(detail.id, detail.revision);
      void message.success(t("tpl.deleted"));
      leave(() => navigate("/templates", { replace: true }));
      queryClient.removeQueries({ queryKey: key });
      void queryClient.invalidateQueries({ queryKey: ["managed-templates"] });
    });

  // FR-TEMPLATE-011: the structure only; the active version, or the draft before the first.
  const doExport = () =>
    busy.run(async () => {
      downloadJson(await exportTemplate(detail.id, !detail.current), `${detail.code}.json`);
      void message.success(t("tpl.exported"));
    });

  const owner =
    detail.scope === "system"
      ? t("tpl.ownerSystem")
      : detail.scope === "personal"
        ? t("tpl.ownerPersonal")
        : t("tpl.ownerOrg", { name: tenant?.name ?? "" });
  const reasons = detail.protected_reasons.map((r) => t(`tpl.protected.${r}` as MessageKey)).join(", ");
  const deleteButton = (
    <ConfirmButton
      danger
      label={t("tpl.delete")}
      title={t("tpl.deleteTitle")}
      description={t("tpl.deleteBody")}
      disabled={!detail.deletable}
      onConfirm={remove}
    />
  );

  return (
    <Page
      name="templates"
      title={detail.name}
      description={owner}
      badge={
        <Space size={4}>
          <ScopeTag scope={detail.scope} />
          <StatusTag status={detail.status} />
          {detail.has_draft && <Tag color="warning">{t("tpl.draft")}</Tag>}
        </Space>
      }
      meta={
        <span>
          {detail.current_version ? t("tpl.version", { n: detail.current_version.version }) : t("tpl.notActive")} ·{" "}
          {t("tpl.revision", { n: detail.revision })}
        </span>
      }
      extra={
        <Space wrap>
          <Button onClick={() => void doExport()}>{t("tpl.export")}</Button>
          {manage && (
            <>
              {detail.status === "ENABLED" ? (
                <ConfirmButton label={t("tpl.disable")} title={t("tpl.disableTitle")} onConfirm={toggle} />
              ) : (
                <Button onClick={() => void toggle()}>{t("tpl.enable")}</Button>
              )}
              {detail.deletable ? deleteButton : <Tooltip title={t("tpl.cannotDelete", { reasons })}><span>{deleteButton}</span></Tooltip>}
            </>
          )}
        </Space>
      }
    >
      <ProblemAlert
        problem={problem}
        onReload={async () => {
          await reload();
          restart();
          setProblem(null);
          setJudged(null);
        }}
      />
      {!manage && <Alert type="info" showIcon message={t("tpl.readOnlyNote")} />}
      {manage && !detail.current && <Alert type="info" showIcon message={t("tpl.noActiveNote")} />}
      {manage && detail.current_version && (detail.has_draft || dirty) && (
        <Alert type="info" showIcon message={t("tpl.draftNote", { n: detail.current_version.version })} />
      )}
      {manage && (
        <Space wrap>
          <Button disabled={!dirty} loading={busy.pending} onClick={() => void save()}>
            {t("tpl.saveDraft")}
          </Button>
          <ConfirmButton
            label={t("tpl.discardDraft")}
            title={t("tpl.discardTitle")}
            disabled={!detail.has_draft && !dirty}
            onConfirm={discard}
          />
          <Button type="primary" disabled={!detail.has_draft && !dirty} loading={busy.pending} onClick={() => void doActivate()}>
            {t("tpl.activate")}
          </Button>
        </Space>
      )}
      <section className="pc-panel" aria-label={detail.name}>
        <TemplateEditor
          key={epoch}
          value={value}
          readOnly={!manage}
          errors={errors}
          pendingConfirmations={manage ? pending : []}
          onChange={(next) => setEdit((e) => ({ ...start(e), content: next }))}
          onConfirm={(path, attr) =>
            setEdit((e) => {
              const s = start(e);
              return { ...s, pending: s.pending.filter((p) => !(p.path === path && p.attr === attr)) };
            })
          }
          onPathsRemap={(remap) =>
            setEdit((e) => {
              const s = start(e);
              return { ...s, pending: remapPending(s.pending, remap) };
            })
          }
          labels={labels}
        />
      </section>
      <section className="pc-panel" aria-label={t("tpl.versions")}>
        <Typography.Title level={2} className="pc-section-title">
          {t("tpl.versions")}
        </Typography.Title>
        <List
          size="small"
          dataSource={detail.versions}
          locale={{ emptyText: t("tpl.noVersions") }}
          renderItem={(v) => (
            <List.Item
              actions={[
                <Button key="view" size="small" onClick={() => setVersionId(v.id)}>
                  {t("tpl.view")}
                </Button>,
              ]}
            >
              <Space>
                <strong>{t("tpl.version", { n: v.version })}</strong>
                <span>{v.name}</span>
                <Typography.Text type="secondary">{formatBangkokDateTime(v.created_at)}</Typography.Text>
                {v.id === detail.current_version?.id && <Tag color="success">{t("tpl.versionActive")}</Tag>}
              </Space>
            </List.Item>
          )}
        />
      </section>
      <VersionModal detail={detail} versionId={versionId} onClose={() => setVersionId(null)} />
      {guard}
    </Page>
  );
}

function DetailLoader() {
  const t = useT();
  const id = Number(useParams().id);
  const valid = Number.isInteger(id) && id > 0;
  const template = useTemplate(id);
  // another tenant's template answers 404, like a missing one (AC-FR-SYS-140-03)
  if (!valid || (template.error instanceof ApiError && template.error.status === 404)) {
    return <Result status="404" title={t("tpl.notFound")} />;
  }
  if (template.error) return <Alert role="alert" type="error" showIcon message={errorMessage(template.error, t)} />;
  if (!template.data) return <Spin />;
  return <Detail key={template.data.id} detail={template.data} reload={() => template.refetch()} />;
}

/** /templates/:id: the template, its draft in the editor, activation and version history
 * (FR-TEMPLATE-003..013). */
export function TemplateDetailPage() {
  return (
    <TemplateGate>
      <DetailLoader />
    </TemplateGate>
  );
}
