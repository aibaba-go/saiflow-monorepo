import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Alert,
  App,
  Button,
  Card,
  Descriptions,
  Drawer,
  List,
  Result,
  Space,
  Spin,
  Tag,
  Typography,
} from "antd";
import {
  CODE_PATTERN,
  TemplateEditor,
  validateTemplateClient,
  type PathRemap,
  type PendingConfirmation,
  type TemplateContent,
  type TemplatePathError,
} from "@saiflow/ui/template-editor";
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { Link, Navigate, useLocation, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { ConfirmButton } from "../components/ConfirmButton";
import { ErrorText } from "../components/ErrorText";
import { GrantsPanel } from "../components/GrantsPanel";
import { Page } from "../components/Page";
import { formatTime } from "../format";
import { useSubmit } from "../hooks/useSubmit";
import { useT, type T } from "../i18n";
import { templateEditorLabels } from "../i18n/templateEditor";
import { ApiError } from "../services/errors";
import { idParam } from "../services/organizations";
import {
  downloadJson,
  editableContent,
  emptyContent,
  grantSummary,
  inUseReasons,
  isCode,
  ownerLabel,
  pathErrors,
  templateKeys,
  templates,
  versionContent,
  type TemplateDetail,
  type TemplateTarget,
} from "../services/templates";
import { useLanguage } from "../stores/language";
import { ownerText, type NewTemplateState } from "./TemplatesPage";

// ---------------------------------------------------------------- shared pieces

/** Warn before the browser leaves a page with unsaved edits. The console uses BrowserRouter
 * (no data router), so in-app links are guarded by GuardedLink instead of useBlocker. */
function useLeaveWarning(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);
}

function GuardedLink({ to, dirty, children }: { to: string; dirty: boolean; children: ReactNode }) {
  const t = useT();
  const { modal } = App.useApp();
  const navigate = useNavigate();
  const onClick = (e: MouseEvent) => {
    if (!dirty) return;
    e.preventDefault();
    modal.confirm({
      title: t("tpl.leaveConfirm"),
      okText: t("common.confirm"),
      cancelText: t("common.cancel"),
      onOk: () => navigate(to),
    });
  };
  return (
    <Link to={to} onClick={onClick}>
      {children}
    </Link>
  );
}

function useEditorLabels() {
  return templateEditorLabels(useLanguage((s) => s.lang));
}

/** A client "code" error before the first save: the server needs a valid code to store a draft. */
function codeErrors(content: TemplateContent, t: T): TemplatePathError[] {
  return CODE_PATTERN.test(content.code ?? "") ? [] : [{ path: "code", message: t("field.code") }];
}

/** Editor errors for a failed save: a bad or conflicting code is shown at the code input. */
function saveErrors(error: unknown, t: T): TemplatePathError[] | null {
  if (error instanceof ApiError && error.code === "validation_error" && error.fields.includes("code")) {
    return [{ path: "code", message: t("field.code") }];
  }
  if (isCode(error, "template_code_conflict")) return [{ path: "code", message: t("err.template_code_conflict") }];
  return null;
}

function conflictCode(error: unknown): string {
  const code = (error as ApiError).details?.code;
  return typeof code === "string" ? code : "";
}

/** The page-level message of an action error (template_invalid is shown by the editor). */
function ActionError({ error }: { error: unknown }) {
  const t = useT();
  if (!error) return null;
  if (isCode(error, "template_code_conflict")) {
    return <Alert role="alert" type="error" showIcon message={t("tpl.codeConflict", { code: conflictCode(error) })} />;
  }
  if (isCode(error, "template_invalid")) {
    return <Alert role="alert" type="error" showIcon message={t("tpl.activateErrors")} />;
  }
  if (isCode(error, "template_in_use")) {
    return <Alert role="alert" type="error" showIcon message={<ReasonsText reasons={inUseReasons(error)} />} />;
  }
  if (isCode(error, "revision_conflict")) return null; // the conflict banner says it
  return <ErrorText error={error} />;
}

function ReasonsText({ reasons }: { reasons: readonly string[] }) {
  const t = useT();
  const lang = useLanguage((s) => s.lang);
  const text = reasons
    .map((r) => (r === "applied" || r === "report" || r === "review_settings" ? t(`tpl.reason.${r}`) : r))
    .join(lang === "zh" ? "、" : ", ");
  return <>{reasons.length ? t("tpl.protected", { reasons: text }) : t("err.template_in_use")}</>;
}

const same = (a: TemplateContent, b: TemplateContent) => JSON.stringify(a) === JSON.stringify(b);

// ---------------------------------------------------------------- /templates/new

/** A new template for the system or one customer tenant, written or imported (FR-SYS-142,
 * FR-TEMPLATE-011). Saving creates a draft only. */
export function TemplateNewPage() {
  const [params] = useSearchParams();
  const tenantId = idParam(params.get("tenant_id") ?? undefined);
  const scope = params.get("scope");
  if (scope === "system") return <NewTemplate target={{ scope: "system" }} />;
  if (scope === "tenant" && tenantId !== null) return <NewTemplate target={{ scope: "tenant", tenantId }} />;
  return <Navigate to="/templates" replace />;
}

function NewTemplate({ target }: { target: TemplateTarget }) {
  const t = useT();
  const labels = useEditorLabels();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const state = (useLocation().state ?? {}) as NewTemplateState;
  const source = state.source === "import" ? "import" : "manual";
  const [initial] = useState<TemplateContent>(() => (state.content as TemplateContent | undefined) ?? emptyContent());
  const [content, setContent] = useState(initial);
  const [errors, setErrors] = useState<TemplatePathError[]>([]);
  const [error, setError] = useState<unknown>(null);
  const dirty = source === "import" || !same(content, initial);
  useLeaveWarning(dirty);

  const owner =
    target.scope === "system"
      ? t("tpl.ownerSystem")
      : state.owner && state.owner.tenant_id === target.tenantId
        ? ownerLabel(state.owner, t)
        : t("tenant.ref", { id: target.tenantId });

  const { run, pending } = useSubmit(async () => {
    setError(null);
    const local = codeErrors(content, t);
    if (local.length) return setErrors(local);
    try {
      const created = await templates.create(target, content, source);
      queryClient.setQueryData(templateKeys.one(created.id), created);
      await queryClient.invalidateQueries({ queryKey: templateKeys.lists });
      void message.success(t("tpl.created"));
      navigate(`/templates/${created.id}`, { replace: true });
    } catch (e) {
      setError(e);
      setErrors(saveErrors(e, t) ?? []);
    }
  });

  return (
    <Page
      name="template"
      title={t("tpl.newTitle")}
      extra={
        <GuardedLink to="/templates" dirty={dirty}>
          {t("tpl.back")}
        </GuardedLink>
      }
    >
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <Typography.Text strong data-testid="template-target">
          {t("tpl.targetIs", { owner })}
        </Typography.Text>
        {source === "import" && <Alert type="info" showIcon message={t("tpl.import.note")} />}
        <ActionError error={error} />
        <Space>
          <Button type="primary" loading={pending} onClick={() => void run()}>
            {t("tpl.saveDraft")}
          </Button>
        </Space>
        <Card title={t("tpl.editingDraft")}>
          <TemplateEditor
            value={content}
            onChange={(next) => {
              // a new code clears the code error (bad or already used); other errors stay
              if (next.code !== content.code) setErrors((prev) => prev.filter((e) => e.path !== "code"));
              setContent(next);
            }}
            errors={errors}
            labels={labels}
          />
        </Card>
      </Space>
    </Page>
  );
}

// ---------------------------------------------------------------- /templates/:id

export function TemplateDetailPage() {
  const t = useT();
  const id = idParam(useParams().id);
  if (id === null) return <Result status="404" title={t("common.notFound")} />;
  return <DetailLoader key={id} id={id} />;
}

function DetailLoader({ id }: { id: number }) {
  // always read the latest revision before editing; later background reads never replace edits
  const detail = useQuery({
    queryKey: templateKeys.one(id),
    queryFn: () => templates.get(id),
    refetchOnMount: "always",
    refetchOnWindowFocus: false,
  });
  if (detail.isError) return <ErrorText error={detail.error} />;
  if (!detail.data || !detail.isFetchedAfterMount) return <Spin style={{ display: "block", marginTop: 80 }} />;
  return <Workbench initial={detail.data} />;
}

function remapPaths<E extends { path: string }>(list: E[], remap: PathRemap): E[] {
  const out: E[] = [];
  for (const e of list) {
    const path = remap(e.path);
    if (path !== null) out.push({ ...e, path });
  }
  return out;
}

/** Draft editing, activation, status, export, delete, grants and history of one template
 * (FR-SYS-142, FR-TEMPLATE-010..013). The server's revision guards every change; a stale
 * one keeps the local edits and offers a reload, never an overwrite. */
function Workbench({ initial }: { initial: TemplateDetail }) {
  const t = useT();
  const labels = useEditorLabels();
  const { message } = App.useApp();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [detail, setDetail] = useState(initial);
  const [content, setContent] = useState(() => editableContent(initial));
  const [saved, setSaved] = useState(() => editableContent(initial));
  const [pending, setPending] = useState<PendingConfirmation[]>(initial.pending_confirmations as PendingConfirmation[]);
  const [errors, setErrors] = useState<TemplatePathError[]>(initial.draft_errors);
  const [error, setError] = useState<unknown>(null);
  const [conflict, setConflict] = useState<number | string | null>(null);
  const [grantsKey, setGrantsKey] = useState(0);
  const [history, setHistory] = useState(false);
  const id = detail.id;
  const dirty = !same(content, saved) || pending.length !== initialPendingCount(detail);
  useLeaveWarning(dirty);

  function store(next: TemplateDetail) {
    setDetail(next);
    queryClient.setQueryData(templateKeys.one(next.id), next);
    void queryClient.invalidateQueries({ queryKey: templateKeys.lists });
  }

  /** Take the server's state as the new baseline (after save, discard, activate or reload). */
  function reset(next: TemplateDetail) {
    store(next);
    const c = editableContent(next);
    setContent(c);
    setSaved(c);
    setPending(next.pending_confirmations as PendingConfirmation[]);
    setErrors(next.draft_errors);
    setConflict(null);
  }

  function failed(e: unknown) {
    setError(e);
    if (isCode(e, "revision_conflict")) {
      const revision = (e as ApiError).details?.revision;
      setConflict(typeof revision === "number" ? revision : "?");
    }
  }

  async function act(fn: () => Promise<void>) {
    setError(null);
    try {
      await fn();
    } catch (e) {
      failed(e);
    }
  }

  const save = useSubmit(() =>
    act(async () => {
      try {
        reset(await templates.saveDraft(id, detail.revision, content, pending));
        void message.success(t("tpl.saved"));
      } catch (e) {
        const local = saveErrors(e, t);
        if (local) setErrors(local);
        throw e;
      }
    }),
  );

  const activate = () =>
    act(async () => {
      const local = validateTemplateClient(content);
      if (local.length) {
        setErrors(local);
        void message.error(t("tpl.clientInvalid", { n: local.length }));
        return;
      }
      try {
        const out = await templates.activate(id, detail.revision);
        reset(out.template);
        const n = out.version.version;
        if (out.result === "activated") void message.success(t("tpl.activated", { n }));
        else void message.info(t("tpl.unchanged", { n }));
      } catch (e) {
        const found = pathErrors(e);
        if (found.length) setErrors(found);
        throw e;
      }
    });

  const discard = () =>
    act(async () => {
      reset(await templates.discardDraft(id, detail.revision));
      void message.success(t("tpl.discarded"));
    });

  const setStatus = (status: "ENABLED" | "DISABLED") =>
    act(async () => {
      store(await templates.setStatus(id, detail.revision, status));
      void message.success(t("tpl.statusSaved"));
    });

  const exportJson = (draft: boolean) =>
    act(async () => {
      downloadJson(`${detail.code || "template"}${draft ? "-draft" : ""}.json`, await templates.exportJson(id, draft));
    });

  const remove = () =>
    act(async () => {
      await templates.remove(id, detail.revision);
      queryClient.removeQueries({ queryKey: templateKeys.one(id) });
      await queryClient.invalidateQueries({ queryKey: templateKeys.lists });
      void message.success(t("tpl.deleted"));
      navigate("/templates", { replace: true });
    });

  const reload = () =>
    act(async () => {
      const latest = await queryClient.fetchQuery({ queryKey: templateKeys.one(id), queryFn: () => templates.get(id), staleTime: 0 });
      reset(latest);
      setGrantsKey((k) => k + 1);
      setError(null);
    });

  const current = detail.current_version;
  const editingTitle =
    detail.has_draft || !current ? t("tpl.editingDraft") : t("tpl.editingFromActive", { n: current.version });

  return (
    <Page
      name="template"
      title={detail.name || detail.code}
      extra={
        <GuardedLink to="/templates" dirty={dirty}>
          {t("tpl.back")}
        </GuardedLink>
      }
    >
      <Space direction="vertical" size="large" style={{ width: "100%" }}>
        <Alert type="info" showIcon message={t("tpl.adminNote")} />
        {conflict !== null && (
          <Alert
            role="alert"
            type="warning"
            showIcon
            message={t("tpl.conflict", { revision: conflict })}
            action={<ConfirmButton label={t("tpl.reload")} title={t("tpl.confirmReload")} onConfirm={reload} />}
          />
        )}
        <Card>
          <Descriptions data-testid="template-facts" column={{ xs: 1, md: 2 }} size="small">
            <Descriptions.Item label={t("tpl.col.code")}>{detail.code}</Descriptions.Item>
            <Descriptions.Item label={t("tpl.col.owner")}>{ownerText(detail, null, t)}</Descriptions.Item>
            <Descriptions.Item label={t("col.status")}>
              <Tag color={detail.status === "ENABLED" ? "green" : "red"}>{t(`tpl.status.${detail.status}`)}</Tag>
            </Descriptions.Item>
            <Descriptions.Item label={t("tpl.activeVersion")}>
              {current ? (
                <Tag color="blue">
                  {t("tpl.version", { n: current.version })} · {formatTime(current.activated_at)}
                </Tag>
              ) : (
                t("tpl.notActive")
              )}
            </Descriptions.Item>
            <Descriptions.Item label={t("tpl.draftState")}>
              {detail.has_draft ? <Tag color="gold">{t("tpl.draftSaved")}</Tag> : t("tpl.noDraft")}
            </Descriptions.Item>
            {detail.scope === "system" && (
              <Descriptions.Item label={t("tpl.col.grant")}>{grantSummary(detail.grant, t)}</Descriptions.Item>
            )}
            <Descriptions.Item label={t("tpl.col.updated")}>{formatTime(detail.updated_at)}</Descriptions.Item>
          </Descriptions>
          <Space wrap>
            <Button onClick={() => setHistory(true)}>{t("tpl.history")}</Button>
            {current && <Button onClick={() => void exportJson(false)}>{t("tpl.export")}</Button>}
            {detail.has_draft && <Button onClick={() => void exportJson(true)}>{t("tpl.exportDraft")}</Button>}
            {detail.status === "ENABLED" ? (
              <ConfirmButton
                key="disable"
                label={t("tpl.disable")}
                title={t("tpl.confirmDisable")}
                onConfirm={() => setStatus("DISABLED")}
              />
            ) : (
              <ConfirmButton
                key="enable"
                label={t("tpl.enable")}
                title={t("tpl.confirmEnable")}
                onConfirm={() => setStatus("ENABLED")}
              />
            )}
            <ConfirmButton
              danger
              label={t("tpl.delete")}
              title={t("tpl.confirmDelete")}
              disabled={!detail.deletable}
              onConfirm={remove}
            />
          </Space>
          {!detail.deletable && (
            <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
              <ReasonsText reasons={detail.protected_reasons} />
            </Typography.Paragraph>
          )}
        </Card>

        <ActionError error={error} />

        <Card
          title={
            <Space>
              <span>{editingTitle}</span>
              {dirty && <Tag color="orange">{t("tpl.unsaved")}</Tag>}
            </Space>
          }
          extra={
            <Space wrap>
              <Button type="primary" loading={save.pending} disabled={!dirty} onClick={() => void save.run()}>
                {t("tpl.saveDraft")}
              </Button>
              <ConfirmButton
                label={t("tpl.discard")}
                title={t("tpl.confirmDiscard")}
                disabled={!detail.has_draft}
                onConfirm={discard}
              />
              <ConfirmButton
                label={t("tpl.activate")}
                title={t("tpl.confirmActivate")}
                disabled={dirty || !detail.has_draft}
                onConfirm={activate}
              />
            </Space>
          }
        >
          {dirty && detail.has_draft && (
            <Typography.Paragraph type="secondary">{t("tpl.saveFirst")}</Typography.Paragraph>
          )}
          <TemplateEditor
            value={content}
            onChange={setContent}
            errors={errors}
            pendingConfirmations={pending}
            onConfirm={(path, attr) => setPending((list) => list.filter((p) => !(p.path === path && p.attr === attr)))}
            onPathsRemap={(remap) => {
              setPending((list) => remapPaths(list, remap));
              setErrors((list) => remapPaths(list, remap));
            }}
            labels={labels}
          />
        </Card>

        {detail.scope === "system" && (
          <GrantsPanel key={grantsKey} detail={detail} onSaved={store} onConflict={failed} />
        )}
      </Space>
      <HistoryDrawer open={history} detail={detail} onClose={() => setHistory(false)} />
    </Page>
  );
}

function initialPendingCount(detail: TemplateDetail) {
  return detail.pending_confirmations.length;
}

/** Every activated version, read-only (FR-TEMPLATE-013); the active one is marked. */
function HistoryDrawer({ open, detail, onClose }: { open: boolean; detail: TemplateDetail; onClose: () => void }) {
  const t = useT();
  const labels = useEditorLabels();
  const [viewing, setViewing] = useState<number | null>(null);
  const version = useQuery({
    queryKey: templateKeys.version(detail.id, viewing ?? 0),
    queryFn: () => templates.version(detail.id, viewing!),
    enabled: open && viewing !== null,
  });
  return (
    <Drawer open={open} onClose={onClose} title={t("tpl.history")} width={960} destroyOnClose>
      <Space direction="vertical" size="middle" style={{ width: "100%" }}>
        <List
          size="small"
          bordered
          dataSource={detail.versions}
          locale={{ emptyText: t("tpl.historyEmpty") }}
          renderItem={(v) => (
            <List.Item
              actions={[
                <Button key="view" size="small" onClick={() => setViewing(v.id)}>
                  {t("tpl.view")}
                </Button>,
              ]}
            >
              <Space>
                <strong>{t("tpl.version", { n: v.version })}</strong>
                <span>{v.name}</span>
                <span>{formatTime(v.created_at)}</span>
                {v.id === detail.current_version?.id && <Tag color="blue">{t("tpl.activeMark")}</Tag>}
              </Space>
            </List.Item>
          )}
        />
        {viewing !== null &&
          (version.isError ? (
            <ErrorText error={version.error} />
          ) : !version.data ? (
            <Spin />
          ) : (
            <Card title={t("tpl.versionTitle", { n: version.data.version })}>
              <TemplateEditor value={versionContent(detail.code, version.data)} readOnly labels={labels} />
            </Card>
          ))}
      </Space>
    </Drawer>
  );
}
