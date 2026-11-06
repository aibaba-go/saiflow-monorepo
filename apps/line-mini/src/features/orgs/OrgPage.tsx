import { Button, Popup, Tag, Toast } from "antd-mobile";
import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { BrandLoading } from "../../components/BrandLoading";
import { ErrorText } from "../../components/ErrorText";
import { Field } from "../../components/Field";
import { formLevel, requireFields } from "../../components/FieldError";
import { liffId } from "../../config";
import { useSubmit } from "../../hooks/useSubmit";
import { useT, type MessageKey } from "../../i18n";
import { api, call } from "../../services/api";
import { errorMessage } from "../../services/errors";
import { useSession, type CurrentTenant } from "../../stores/session";
import { confirmAction } from "../../utils/confirm";
import { formatBangkokDate } from "../../utils/format";
import { authLiff, loadIdentity } from "../auth/session";
import { can } from "../tenants/permissions";
import { useCurrentTenant } from "../tenants/useCurrentTenant";
import {
  orgPath,
  useInvitations,
  useMembers,
  useOrg,
  useRefreshOrg,
  useRoles,
  type Member,
  type OrgView,
} from "./orgData";

const VERIFICATION: Record<string, MessageKey> = {
  none: "verify.none",
  pending: "app.pending",
  verified: "verify.verified",
  rejected: "app.rejected",
};

export function inviteUrl(token: string): string {
  return `https://liff.line.me/${liffId}?invite=${encodeURIComponent(token)}`;
}

/** Pick one item from a short list in a bottom sheet. */
function Chooser<V>({
  open,
  title,
  options,
  onPick,
  onClose,
}: {
  open: boolean;
  title: string;
  options: { value: V; label: string }[];
  onPick(value: V): void;
  onClose(): void;
}) {
  return (
    <Popup visible={open} onMaskClick={onClose} bodyStyle={{ padding: 12 }}>
      <div className="section__label">{title}</div>
      <div role="listbox" aria-label={title} className="choice-list">
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="option"
            aria-selected={false}
            className="choice-list__item"
            onClick={() => onPick(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </Popup>
  );
}

function ProfileSection({ org, tenant }: { org: OrgView; tenant: CurrentTenant }) {
  const t = useT();
  const refresh = useRefreshOrg(org.tenant_id);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(org.name);
  const [phone, setPhone] = useState(org.contact_phone);
  const [address, setAddress] = useState(org.address ?? "");
  const [error, setError] = useState<unknown>(null);
  const save = useSubmit(async () => {
    const missing = requireFields({ name, contact_phone: phone });
    setError(missing);
    if (missing) return;
    try {
      await call(
        api.PATCH("/api/v1/organizations/{tenant_id}", {
          ...orgPath(org.tenant_id),
          body: { name, contact_phone: phone, address },
        }),
      );
      await refresh();
      await loadIdentity();
      setEditing(false);
    } catch (err) {
      setError(err);
    }
  });

  if (editing) {
    return (
      <div className="form">
        <Field id="org-edit-name" label={t("org.name")} value={name} onChange={setName} error={error} field="name" />
        <Field
          id="org-edit-phone"
          label={t("org.phone")}
          value={phone}
          onChange={setPhone}
          error={error}
          field="contact_phone"
          type="tel"
        />
        <Field
          id="org-edit-address"
          label={t("org.addressOptional")}
          value={address}
          onChange={setAddress}
          error={error}
          field="address"
        />
        <ErrorText error={formLevel(error)} />
        <Button color="primary" loading={save.pending} onClick={() => void save.run()}>
          {t("common.save")}
        </Button>
      </div>
    );
  }
  return (
    <div className="card-row">
      <div className="card-row__title">{org.name}</div>
      <div className="card-row__meta">{org.contact_phone}</div>
      {org.address && <div className="card-row__meta">{org.address}</div>}
      <div className="card-row__meta">
        {t("org.verification")}: {t(VERIFICATION[org.verification_status]!)}
      </div>
      {can(tenant, "member_manage") && (
        <Button size="small" onClick={() => setEditing(true)}>
          {t("common.edit")}
        </Button>
      )}
    </div>
  );
}

function InviteSection({ org, tenant }: { org: OrgView; tenant: CurrentTenant }) {
  const t = useT();
  const refresh = useRefreshOrg(org.tenant_id);
  const invitations = useInvitations(org.tenant_id, true);
  const [error, setError] = useState<unknown>(null);
  const [link, setLink] = useState<string | null>(null);
  const full = org.member_limit !== null && org.seats_used >= org.member_limit;
  const liff = authLiff();
  const canShare = liff.isApiAvailable("shareTargetPicker");

  /** Share in LINE, or copy; the link stays on screen either way (it is shown only once). */
  const share = async (url: string) => {
    if (canShare) {
      await liff.shareTargetPicker([{ type: "text", text: t("invite.message", { name: org.name, url }) }]);
      return;
    }
    try {
      if (!navigator.clipboard) return;
      await navigator.clipboard.writeText(url);
      Toast.show({ content: t("invite.copied") });
    } catch {
      // no clipboard permission: the user copies the link shown below
    }
  };

  const invite = useSubmit(async () => {
    setError(null);
    try {
      const created = await call(
        api.POST("/api/v1/organizations/{tenant_id}/invitations", orgPath(org.tenant_id)),
      );
      const url = inviteUrl(created.token);
      setLink(url);
      await refresh();
      await share(url);
    } catch (err) {
      setError(err);
    }
  });

  const revoke = async (id: number) => {
    if (!(await confirmAction(t, t("invite.revokeTitle")))) return;
    try {
      await call(
        api.DELETE("/api/v1/organizations/{tenant_id}/invitations/{invitation_id}", {
          params: { path: { tenant_id: org.tenant_id, invitation_id: id } },
        }),
      );
      await refresh();
    } catch (err) {
      setError(err);
    }
  };

  if (!can(tenant, "member_manage")) return null;
  return (
    <div className="section">
      <Button color="primary" disabled={full} loading={invite.pending} onClick={() => void invite.run()}>
        {t("org.invite")}
      </Button>
      {full && <div className="card-row__meta">{t("err.member_limit_reached")}</div>}
      {link && (
        <div className="card-row">
          <div className="card-row__meta">{t("invite.linkHint")}</div>
          <div className="invite-link">{link}</div>
          <Button size="mini" onClick={() => void share(link)}>
            {canShare ? t("invite.shareAgain") : t("invite.copy")}
          </Button>
        </div>
      )}
      <ErrorText error={error} />
      {invitations.data?.map((inv) => (
        <div key={inv.id} className="card-row card-row--inline">
          <span>{t("invite.expires", { date: formatBangkokDate(inv.expires_at) })}</span>
          <Button size="mini" onClick={() => void revoke(inv.id)}>
            {t("invite.revoke")}
          </Button>
        </div>
      ))}
    </div>
  );
}

function MemberRow({
  member,
  tenant,
  selfId,
  orgId,
  onError,
}: {
  member: Member;
  tenant: CurrentTenant;
  selfId: number | null;
  orgId: number;
  onError(error: unknown): void;
}) {
  const t = useT();
  const refresh = useRefreshOrg(orgId);
  const canRole = can(tenant, "role_manage");
  const roles = useRoles(orgId, canRole);
  const [choosing, setChoosing] = useState(false);
  const actionable = !member.is_owner && member.user_id !== selfId;
  const userPath = { params: { path: { tenant_id: orgId, user_id: member.user_id } } };

  const assign = async (roleId: number) => {
    setChoosing(false);
    try {
      await call(
        api.PUT("/api/v1/organizations/{tenant_id}/members/{user_id}/role", {
          ...userPath,
          body: { role_id: roleId },
        }),
      );
      await refresh();
    } catch (err) {
      onError(err);
    }
  };
  const remove = async () => {
    if (!(await confirmAction(t, t("member.removeTitle", { name: member.display_name ?? "" })))) return;
    try {
      await call(api.DELETE("/api/v1/organizations/{tenant_id}/members/{user_id}", userPath));
      await refresh();
    } catch (err) {
      onError(err);
    }
  };

  return (
    <div className="card-row" data-member={member.user_id}>
      <div className="card-row__title">
        {member.display_name}{" "}
        {member.is_owner ? <Tag color="primary">{t("member.owner")}</Tag> : <Tag>{member.role?.name}</Tag>}
      </div>
      <div className="card-row__meta">{t("member.joined", { date: formatBangkokDate(member.joined_at) })}</div>
      {actionable && (canRole || can(tenant, "member_manage")) && (
        <div className="card-row__actions">
          {canRole && (
            <Button size="mini" onClick={() => setChoosing(true)}>
              {t("member.changeRole")}
            </Button>
          )}
          {can(tenant, "member_manage") && (
            <Button size="mini" color="danger" onClick={() => void remove()}>
              {t("member.remove")}
            </Button>
          )}
        </div>
      )}
      <Chooser
        open={choosing}
        title={t("member.changeRole")}
        options={(roles.data ?? []).map((r) => ({ value: r.id, label: r.name }))}
        onPick={(id) => void assign(id)}
        onClose={() => setChoosing(false)}
      />
    </div>
  );
}

function OwnerActions({ org, tenant, members }: { org: OrgView; tenant: CurrentTenant; members: Member[] }) {
  const t = useT();
  const navigate = useNavigate();
  const me = useSession((s) => s.me);
  const { setTenant } = useCurrentTenant();
  const refresh = useRefreshOrg(org.tenant_id);
  const [choosing, setChoosing] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const transfer = async (userId: number) => {
    setChoosing(false);
    const target = members.find((m) => m.user_id === userId);
    if (!(await confirmAction(t, t("owner.transferTitle", { name: target?.display_name ?? "" })))) return;
    try {
      await call(
        api.POST("/api/v1/organizations/{tenant_id}/owner-transfer", {
          ...orgPath(org.tenant_id),
          body: { user_id: userId },
        }),
      );
      await loadIdentity();
      await refresh();
    } catch (err) {
      setError(err);
    }
  };
  const leave = async () => {
    if (!(await confirmAction(t, t("org.leaveTitle", { name: org.name })))) return;
    try {
      await call(api.POST("/api/v1/organizations/{tenant_id}/leave", orgPath(org.tenant_id)));
      setTenant(null);
      await loadIdentity();
      navigate("/");
    } catch (err) {
      setError(err);
    }
  };

  return (
    <div className="section">
      {tenant.is_owner ? (
        <Button onClick={() => setChoosing(true)}>{t("owner.transfer")}</Button>
      ) : (
        <Button color="danger" fill="outline" onClick={() => void leave()}>
          {t("org.leave")}
        </Button>
      )}
      <ErrorText error={error} />
      <Chooser
        open={choosing}
        title={t("owner.transfer")}
        options={members
          .filter((m) => m.user_id !== me?.user_id)
          .map((m) => ({ value: m.user_id, label: m.display_name ?? "" }))}
        onPick={(id) => void transfer(id)}
        onClose={() => setChoosing(false)}
      />
    </div>
  );
}

function OrgContent({ tenant }: { tenant: CurrentTenant }) {
  const t = useT();
  const navigate = useNavigate();
  const me = useSession((s) => s.me);
  const org = useOrg(tenant.tenant_id);
  const members = useMembers(tenant.tenant_id);
  const [error, setError] = useState<unknown>(null);
  if (org.isPending || members.isPending) return <BrandLoading label={t("common.loading")} />;
  if (org.isError) return <ErrorText error={org.error} />;
  if (members.isError) return <ErrorText error={members.error} />;
  const view = org.data;
  const seats =
    view.member_limit === null
      ? t("org.seatsUnlimited", { used: view.seats_used })
      : t("org.seats", { used: view.seats_used, limit: view.member_limit });

  return (
    <div className="page">
      <h1 className="page__title">{t("org.title")}</h1>
      <ProfileSection org={view} tenant={tenant} />
      <div className="section__label">{seats}</div>
      <InviteSection org={view} tenant={tenant} />
      {error ? <div role="alert">{errorMessage(error, t)}</div> : null}
      {members.data.map((m) => (
        <MemberRow
          key={m.user_id}
          member={m}
          tenant={tenant}
          selfId={me?.user_id ?? null}
          orgId={view.tenant_id}
          onError={setError}
        />
      ))}
      <div className="card-row__actions">
        {can(tenant, "role_manage") && <Button onClick={() => navigate("/org/roles")}>{t("roles.title")}</Button>}
        {tenant.is_owner && (
          <Button onClick={() => navigate("/org/review-settings")}>{t("review.settings")}</Button>
        )}
        {can(tenant, "verification_apply") && (
          <Button onClick={() => navigate("/org/verification")}>{t("org.verification")}</Button>
        )}
      </div>
      <OwnerActions org={view} tenant={tenant} members={members.data} />
    </div>
  );
}

/** The current organization (FR-SYS-048, 050): profile, seats, invitations, members. */
export function OrgPage() {
  const t = useT();
  const { tenant } = useCurrentTenant();
  if (!tenant || tenant.kind !== "organization") {
    return (
      <div className="page">
        <div>{t("org.none")}</div>
      </div>
    );
  }
  return <OrgContent key={tenant.tenant_id} tenant={tenant} />;
}
