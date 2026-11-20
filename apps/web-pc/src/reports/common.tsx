import type { components } from "@saiflow/api-client";
import { Result, Spin, Tag } from "antd";
import type { ReactNode } from "react";

import { useUsage } from "../billing/useUsage";
import { ErrorText } from "../components/ErrorText";
import { useT, type MessageKey } from "../i18n";
import { can } from "../tenants/permissions";
import type { CurrentTenant } from "../tenants/useCurrentTenant";
import { useTenant } from "../tenants/useTenant";
import type { ReportSummary } from "./api";

type Usage = components["schemas"]["UsageOut"];

const REPORT_PLANS = new Set(["starter", "intermediate", "advance"]);

export interface ReportAccess {
  /** The tenant may use reports at all: an organization on an active Starter+ plan. */
  available: boolean;
  /** report_manage (or owner): design, save, publish, preview on real data. */
  manage: boolean;
  /** report_view (or owner): read published pages. */
  view: boolean;
  /** export (or owner) on top of view: CSV of a card. */
  export: boolean;
}

/** Who may do what with reports here (FR-SYS-141, FR-REPORT-005; same plan rule as the LINE
 * Report tab). The backend decides too; this only hides what would be refused. */
export function reportAccess(tenant: CurrentTenant | null, usage: Usage | undefined): ReportAccess {
  const available =
    !!tenant && tenant.kind === "organization" && !!usage?.active && !!usage.plan && REPORT_PLANS.has(usage.plan.code);
  const manage = available && can(tenant, "report_manage");
  const view = available && can(tenant, "report_view");
  return { available, manage, view, export: view && can(tenant, "export") };
}

/** Whether the tenant could see reports at all, before asking for its plan. */
function mayHoldReports(tenant: CurrentTenant | null): boolean {
  return !!tenant && tenant.kind === "organization" && (can(tenant, "report_manage") || can(tenant, "report_view"));
}

export function useReportAccess() {
  const { tenant } = useTenant();
  const wanted = mayHoldReports(tenant);
  const usage = useUsage(wanted);
  return {
    access: reportAccess(tenant, usage.data),
    loading: wanted && usage.isPending,
    error: wanted ? usage.error : null,
    retry: usage.refetch,
  };
}

/** A report route opened without the plan or the right: an explanation page (the backend
 * refuses too). Children are keyed by tenant so a switch drops the old statistics. */
export function ReportGate({ need, children }: { need: "any" | "manage" | "view"; children: ReactNode }) {
  const t = useT();
  const { tenant } = useTenant();
  const { access, loading, error } = useReportAccess();
  const noAccess = (
    <Result status="403" title={t("rpt.noAccess")} subTitle={t(need === "manage" ? "rpt.noManage" : "rpt.noView")} />
  );
  // an organization member without any report permission: a permission matter, not the plan
  if (tenant?.kind === "organization" && !mayHoldReports(tenant)) return noAccess;
  if (loading) return <Spin />;
  if (error) return <ErrorText error={error} />;
  if (!access.available) {
    return <Result status="403" title={t("rpt.unavailable")} subTitle={t("rpt.unavailableBody")} />;
  }
  const ok = need === "any" ? access.manage || access.view : access[need];
  if (!ok) return noAccess;
  return <div key={tenant?.tenant_id}>{children}</div>;
}

const STATUS_COLOR: Record<ReportSummary["status"], string> = { draft: "default", published: "success", changed: "warning" };

export function ReportStatusTag({ status }: { status: ReportSummary["status"] }) {
  const t = useT();
  return <Tag color={STATUS_COLOR[status]}>{t(`rpt.status.${status}` as MessageKey)}</Tag>;
}
