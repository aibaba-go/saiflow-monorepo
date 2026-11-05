import type { ColumnsType } from "antd/es/table";
import { Link } from "react-router-dom";

import { ApplicationQueue } from "../components/ApplicationQueue";
import { formatTime, PLAN_NAMES } from "../format";
import { useT } from "../i18n";
import {
  organizationQueue,
  planQueue,
  verificationQueue,
  type OrgApplication,
  type PlanApplication,
  type VerificationApplication,
} from "../services/applications";

/** Organization applications (FR-SYS-063). */
export function OrgApplicationsPage() {
  const t = useT();
  const columns: ColumnsType<OrgApplication> = [
    { title: t("col.applicant"), key: "applicant", render: (_, r) => t("user.ref", { id: r.applicant_user_id }) },
    { title: t("col.name"), dataIndex: "name" },
    { title: t("col.phone"), dataIndex: "contact_phone" },
    { title: t("col.address"), key: "address", render: (_, r) => r.address ?? "—" },
    { title: t("col.createdAt"), key: "created", render: (_, r) => formatTime(r.created_at) },
    { title: t("col.decidedAt"), key: "decided", render: (_, r) => formatTime(r.decided_at) },
  ];
  return <ApplicationQueue title="nav.organizationApplications" queue={organizationQueue} columns={columns} />;
}

/** Enterprise verification applications (FR-SYS-065). */
export function VerificationApplicationsPage() {
  const t = useT();
  const columns: ColumnsType<VerificationApplication> = [
    {
      title: t("col.organization"),
      key: "tenant",
      render: (_, r) => <Link to={`/organizations/${r.tenant_id}`}>{t("tenant.ref", { id: r.tenant_id })}</Link>,
    },
    { title: t("col.legalName"), dataIndex: "legal_name" },
    { title: t("col.taxId"), dataIndex: "tax_id" },
    { title: t("col.registeredAddress"), dataIndex: "registered_address" },
    { title: t("col.createdAt"), key: "created", render: (_, r) => formatTime(r.created_at) },
  ];
  return <ApplicationQueue title="nav.verification" queue={verificationQueue} columns={columns} />;
}

/** Plan purchase and renewal applications (FR-SYS-067). */
export function PlanApplicationsPage() {
  const t = useT();
  const columns: ColumnsType<PlanApplication> = [
    { title: t("col.tenant"), key: "tenant", render: (_, r) => t("tenant.ref", { id: r.tenant_id }) },
    { title: t("col.applicant"), key: "applicant", render: (_, r) => t("user.ref", { id: r.applicant_user_id }) },
    { title: t("col.plan"), key: "plan", render: (_, r) => PLAN_NAMES[r.plan_code] ?? r.plan_code },
    { title: t("col.period"), key: "period", render: (_, r) => t(`period.${r.period}`) },
    { title: t("col.note"), key: "note", render: (_, r) => r.note ?? "—" },
    { title: t("col.createdAt"), key: "created", render: (_, r) => formatTime(r.created_at) },
    { title: t("col.decidedAt"), key: "decided", render: (_, r) => formatTime(r.decided_at) },
  ];
  return <ApplicationQueue title="nav.planApplications" queue={planQueue} columns={columns} approveWithDates />;
}
