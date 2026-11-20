import { Space, Spin } from "antd";

import { useMe } from "../auth/session";
import { ErrorText } from "../components/ErrorText";
import { Page } from "../components/Page";
import { useT } from "../i18n";
import { InviteSection } from "../orgs/InviteSection";
import { MembersCard } from "../orgs/MembersCard";
import { OwnerActions, ProfileCard, VerificationCard } from "../orgs/OrgCards";
import { useMembers, useOrg } from "../orgs/orgData";
import { ApiError } from "../services/errors";
import { can } from "../tenants/permissions";
import type { CurrentTenant } from "../tenants/useCurrentTenant";
import { useTenant } from "../tenants/useTenant";

function OrgContent({ tenant }: { tenant: CurrentTenant }) {
  const t = useT();
  const selfId = useMe().data?.user_id ?? null;
  const org = useOrg(tenant.tenant_id);
  const members = useMembers(tenant.tenant_id);
  const gone = org.error instanceof ApiError && org.error.status === 404;

  // A 404 for the current organization re-reads the tenants (services/api.ts, Review Focus 4);
  // the fallback to the personal tenant follows, so nothing raw is shown meanwhile.

  if (org.isPending || members.isPending) return <Spin />;
  if (org.isError) return gone ? <Spin /> : <ErrorText error={org.error} />;
  if (members.isError) return <ErrorText error={members.error} />;
  const view = org.data;
  const seats =
    view.member_limit === null
      ? t("org.seatsUnlimited", { used: view.seats_used })
      : t("org.seats", { used: view.seats_used, limit: view.member_limit });
  return (
    <Space direction="vertical" size="large" style={{ width: "100%" }}>
      <ProfileCard org={view} tenant={tenant} />
      <MembersCard orgId={view.tenant_id} members={members.data} tenant={tenant} selfId={selfId} seats={seats} />
      {can(tenant, "member_manage") && <InviteSection org={view} />}
      <VerificationCard tenant={tenant} />
      <OwnerActions org={view} tenant={tenant} members={members.data} selfId={selfId} />
    </Space>
  );
}

/** The current organization (FR-SYS-098, 100, 101). OrgGate guarantees an organization. */
export function OrgPage() {
  const t = useT();
  const { tenant } = useTenant();
  if (!tenant || tenant.kind !== "organization") return null;
  return (
    <Page name="org" title={tenant.name ?? t("org.title")}>
      <OrgContent key={tenant.tenant_id} tenant={tenant} />
    </Page>
  );
}
