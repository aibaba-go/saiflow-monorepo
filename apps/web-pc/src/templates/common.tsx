import type { TemplateContent } from "@saiflow/ui/template-editor";
import { useQuery } from "@tanstack/react-query";
import { Alert, Button, Image, Modal, Result, Tag } from "antd";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useBlocker } from "react-router-dom";

import { ConfirmButton } from "../components/ConfirmButton";
import { ErrorText } from "../components/ErrorText";
import { useT, type MessageKey } from "../i18n";
import { useUnsaved } from "../ocr/unsaved";
import { ApiError } from "../services/errors";
import { can } from "../tenants/permissions";
import type { CurrentTenant } from "../tenants/useCurrentTenant";
import { useTenant } from "../tenants/useTenant";
import { samplePage, type TemplateSummary } from "./api";

/** Who manages templates here (FR-SYS-140, FR-TEMPLATE-009): the user in the personal
 * tenant, the owner or a template_manage holder in an organization. web-pc has no guest. */
export function canManageTemplates(tenant: CurrentTenant | null): boolean {
  if (!tenant) return false;
  return tenant.kind === "personal" ? tenant.is_owner : can(tenant, "template_manage");
}

/** A template route opened without the right: a no-permission page (the backend refuses
 * too, AC-FR-SYS-140-02). Children are keyed by tenant so a switch starts afresh. */
export function TemplateGate({ children }: { children: ReactNode }) {
  const t = useT();
  const { tenant } = useTenant();
  if (!canManageTemplates(tenant)) {
    return <Result status="403" title={t("tpl.noAccess")} subTitle={t("tpl.noAccessBody")} />;
  }
  return <div key={tenant?.tenant_id}>{children}</div>;
}

const SCOPE_COLOR = { system: "default", personal: "blue", organization: "purple" } as const;

/** The owner of a template as text, not colour only. */
export function ScopeTag({ scope }: { scope: TemplateSummary["scope"] }) {
  const t = useT();
  return <Tag color={SCOPE_COLOR[scope]}>{t(`tpl.scope.${scope}` as MessageKey)}</Tag>;
}

export function StatusTag({ status }: { status: TemplateSummary["status"] }) {
  const t = useT();
  return <Tag color={status === "ENABLED" ? "success" : "default"}>{t(`tpl.status.${status}` as MessageKey)}</Tag>;
}

/** Unsaved edits: ask before leaving by the router, the tenant switcher or closing the tab
 * (FR-SYS-140, as FR-SYS-129). `leave` lets a save navigate without asking. */
export function useLeaveGuard(dirty: boolean): { leave: (go: () => void) => void; guard: ReactNode } {
  const t = useT();
  const leaving = useRef(false);
  const blocker = useBlocker(
    ({ currentLocation, nextLocation }) => dirty && !leaving.current && currentLocation.pathname !== nextLocation.pathname,
  );
  const setUnsaved = useUnsaved((s) => s.setDirty);
  useEffect(() => {
    setUnsaved(dirty);
    return () => setUnsaved(false);
  }, [dirty, setUnsaved]);
  useEffect(() => {
    if (!dirty) return;
    const onUnload = (e: BeforeUnloadEvent) => e.preventDefault();
    window.addEventListener("beforeunload", onUnload);
    return () => window.removeEventListener("beforeunload", onUnload);
  }, [dirty]);
  const guard = (
    <Modal
      open={blocker.state === "blocked"}
      title={t("tpl.leaveTitle")}
      okText={t("tpl.leaveOk")}
      cancelText={t("common.cancel")}
      okButtonProps={{ danger: true }}
      onOk={() => blocker.proceed?.()}
      onCancel={() => blocker.reset?.()}
    >
      {t("tpl.leaveBody")}
    </Modal>
  );
  return {
    leave: (go) => {
      leaving.current = true;
      go();
    },
    guard,
  };
}

/** One page of a sample's original as an object URL, through the api client (tenant header). */
function useSamplePage(sampleId: string, page: number): string | null {
  const { tenant } = useTenant();
  const blob = useQuery({
    queryKey: ["template-sample-page", tenant?.tenant_id, sampleId, page],
    queryFn: () => samplePage(sampleId, page),
    staleTime: 5 * 60_000,
  });
  const url = useMemo(
    () => (blob.data && typeof URL.createObjectURL === "function" ? URL.createObjectURL(blob.data) : null),
    [blob.data],
  );
  useEffect(
    () => () => {
      if (url) URL.revokeObjectURL(url);
    },
    [url],
  );
  return url;
}

const pad = (n: number) => String(n).padStart(2, "0");

/** The sample's original page by page (a PDF arrives as page images), beside the editor
 * (AC-FR-TEMPLATE-008-01). */
export function SamplePages({ sampleId, pageCount }: { sampleId: string; pageCount: number | null }) {
  const t = useT();
  const pages = Math.max(pageCount || 1, 1);
  const [page, setPage] = useState(1);
  const url = useSamplePage(sampleId, page);
  return (
    <div className="pc-viewer">
      <div className="pc-viewer__toolbar">
        <span className="pc-viewer__title">{t("viewer.title")}</span>
      </div>
      <div className="pc-viewer__paper">
        <div className="pc-viewer__sheet" style={{ width: "100%" }}>
          {url ? (
            <Image src={url} alt={t("viewer.title")} width="100%" />
          ) : (
            <div aria-label={t("viewer.title")} className="pc-original__placeholder" />
          )}
        </div>
      </div>
      <div className="pc-viewer__foot">
        {pages > 1 && (
          <Button size="small" type="text" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            {t("review.prevPage")}
          </Button>
        )}
        <span className="pc-viewer__where num">{t("viewer.page", { n: pad(page), total: pad(pages) })}</span>
        {pages > 1 && (
          <Button size="small" type="text" disabled={page >= pages} onClick={() => setPage(page + 1)}>
            {t("review.nextPage")}
          </Button>
        )}
      </div>
    </div>
  );
}

/** Why a save or an activation did not go through, as the page explains it. */
export type Problem =
  | { kind: "invalid" | "unconfirmed" | "conflict" }
  | { kind: "code"; code: string }
  | { kind: "error"; error: unknown };

export function problemOf(error: unknown, content: TemplateContent): Problem {
  if (error instanceof ApiError) {
    if (error.code === "revision_conflict") return { kind: "conflict" };
    if (error.code === "template_invalid") return { kind: "invalid" };
    if (error.code === "template_unconfirmed") return { kind: "unconfirmed" };
    if (error.code === "template_code_conflict") {
      const code = error.details?.code;
      return { kind: "code", code: typeof code === "string" ? code : content.code };
    }
  }
  return { kind: "error", error };
}

/** The explanation of a Problem. A revision conflict keeps the local edits and offers to
 * reload, after a confirmation; nothing is overwritten by itself (FR-TEMPLATE-005). */
export function ProblemAlert({ problem, onReload }: { problem: Problem | null; onReload?: () => Promise<unknown> }) {
  const t = useT();
  if (!problem) return null;
  if (problem.kind === "error") return <ErrorText error={problem.error} />;
  if (problem.kind === "code") {
    return <Alert role="alert" type="error" showIcon message={t("tpl.codeConflict", { code: problem.code })} />;
  }
  if (problem.kind === "conflict") {
    return (
      <Alert
        role="alert"
        type="warning"
        showIcon
        message={t("tpl.conflict")}
        action={
          onReload && <ConfirmButton size="small" label={t("tpl.reload")} title={t("tpl.reloadTitle")} onConfirm={onReload} />
        }
      />
    );
  }
  return (
    <Alert
      role="alert"
      type={problem.kind === "invalid" ? "error" : "warning"}
      showIcon
      message={t(problem.kind === "invalid" ? "tpl.invalid" : "tpl.unconfirmed")}
    />
  );
}
