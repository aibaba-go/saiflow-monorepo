import { Bell, Building, Building2, ChevronRight, Globe, Layers, Plus, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import { useNavigate } from "react-router-dom";

import { ErrorText } from "../components/ErrorText";
import { logout, startLogin } from "../features/auth/session";
import { planName } from "../features/billing/UsageCard";
import { useUsage } from "../features/billing/useUsage";
import { useUnreadCount } from "../features/notifications/data";
import { LanguageButtons } from "../features/profile/LanguagePicker";
import kit from "../features/scan/kit.module.css";
import { TenantSwitcher } from "../features/tenants/TenantSwitcher";
import { useCurrentTenant } from "../features/tenants/useCurrentTenant";
import { useRequireRegistered } from "../features/auth/useRequireRegistered";
import { useSubmit } from "../hooks/useSubmit";
import { useT } from "../i18n";
import { formatCount } from "../utils/format";
import { isUser, useSession } from "../stores/session";
import { confirmAction } from "../utils/confirm";
import { Button } from "../components/ui/button";
import m from "./MyPage.module.css";

/** The first letter of a name for the avatar mark; the photo is not loaded (no external
 * request), so the mark is decorative. */
function initial(name: string | null | undefined): string {
  const first = name?.trim().charAt(0);
  return first ? first.toUpperCase() : "·";
}

/** prototype .settings-row: icon, title, the current value, chevron. */
function SettingsRow({
  icon,
  title,
  value,
  onClick,
}: {
  icon: ReactNode;
  title: string;
  value?: string;
  onClick(): void;
}) {
  return (
    <button type="button" className={m.row} onClick={onClick}>
      <span className={m["row-icon"]} aria-hidden="true">
        {icon}
      </span>
      <span className={m["row-title"]}>{title}</span>
      {value && " "}
      {value && <small className={m["row-value"]}>{value}</small>}
      <ChevronRight size={14} strokeWidth={1.75} className={m["row-chevron"]} aria-hidden="true" />
    </button>
  );
}

/** "My" in the prototype's layout (FR-SYS-041, 043, 046, 138): the profile hero, the current
 * workspace card (opens the tenant switch), account and service rows with their current
 * values, the language buttons and logout. Values come from the session, usage and
 * notification APIs only. */
export function MyPage() {
  const t = useT();
  const navigate = useNavigate();
  const requireRegistered = useRequireRegistered();
  const { tenant } = useCurrentTenant();
  const me = useSession((s) => s.me);
  const loginError = useSession((s) => s.loginError);
  const login = useSubmit(() => startLogin("/my"));
  const out = useSubmit(logout);
  const usage = useUsage();
  const unread = useUnreadCount();
  const user = isUser(me);

  const confirmLogout = async () => {
    const ok = await confirmAction(t, t("my.logoutTitle"), t("my.logoutBody"));
    if (ok) await out.run();
  };

  const plan = usage.data ? (usage.data.plan ? planName(usage.data.plan.code, t) : t("usage.noPlan")) : undefined;
  const role = tenant?.kind === "organization" ? (tenant.is_owner ? t("member.owner") : tenant.role?.name) : undefined;
  const unreadValue =
    unread.data === undefined ? undefined : unread.data > 0 ? t("notify.unread", { n: formatCount(unread.data) }) : t("my.allRead");

  return (
    <div className={m.my}>
      <header className={kit["tab-top"]}>
        <span className={kit["tab-eyebrow"]} aria-hidden="true">
          SAIFLOW
        </span>
        <h1 className={kit["tab-title"]}>{t("my.title")}</h1>
        <span className={kit["tab-end"]} />
      </header>
      <div className={m.content}>
        {user ? (
          <>
            <div className={`my-hero ${m.hero}`}>
              <span className={m.avatar} aria-hidden="true">
                {initial(me?.display_name)}
              </span>
              <div className={m["hero-body"]}>
                <h2>{me?.display_name}</h2>
                <p>{me?.email ?? t("common.notSet")}</p>
              </div>
            </div>
            <TenantSwitcher
              trigger={({ onClick, label }) => (
                <button type="button" className={`${kit.card} ${m.workspace}`} onClick={onClick}>
                  <span className={m["ws-icon"]} aria-hidden="true">
                    <Building2 size={20} strokeWidth={1.75} />
                  </span>
                  <span className={m["ws-body"]}>
                    <span className={m["ws-name"]}>{label}</span>{" "}
                    <span className={m["ws-meta"]}>
                      {[t("my.currentWorkspace"), role, plan].filter(Boolean).join(" · ")}
                    </span>
                  </span>
                  <ChevronRight size={18} strokeWidth={1.75} className={m["row-chevron"]} aria-hidden="true" />
                </button>
              )}
            />
          </>
        ) : (
          <>
            <div className={`my-hero ${m.hero}`}>
              <span className={m.avatar} aria-hidden="true">
                <UserRound size={26} strokeWidth={1.75} />
              </span>
              <div className={m["hero-body"]}>
                <h2>{t("my.guest")}</h2>
                <p>{t("my.guestHint")}</p>
              </div>
            </div>
            <Button block variant="primary" loading={login.pending} onClick={() => void login.run()}>
              {t("auth.loginRegister")}
            </Button>
            <ErrorText error={loginError} />
          </>
        )}
        <div className={kit["section-title"]}>
          <h2>{t("my.sectionAccount")}</h2>
        </div>
        <div className={kit.card}>
          {user && (
            <SettingsRow
              icon={<UserRound size={19} strokeWidth={1.75} />}
              title={t("profile.title")}
              onClick={() => navigate("/profile")}
            />
          )}
          <SettingsRow
            icon={<Layers size={19} strokeWidth={1.75} />}
            title={t("my.plans")}
            value={plan}
            onClick={() => navigate("/plans")}
          />
          {user && (
            <SettingsRow
              icon={<Bell size={19} strokeWidth={1.75} />}
              title={t("notif.title")}
              value={unreadValue}
              onClick={() => navigate("/notifications")}
            />
          )}
          {user && tenant?.kind === "organization" && (
            <SettingsRow
              icon={<Building size={19} strokeWidth={1.75} />}
              title={t("my.organization")}
              value={tenant.name ?? undefined}
              onClick={() => navigate("/org")}
            />
          )}
          {user && (
            <SettingsRow
              icon={<Plus size={19} strokeWidth={1.75} />}
              title={t("my.createOrg")}
              onClick={() => requireRegistered() && navigate("/orgs/apply")}
            />
          )}
          <div className={`${m.row} ${m["lang-row"]}`}>
            <span className={m["row-icon"]} aria-hidden="true">
              <Globe size={19} strokeWidth={1.75} />
            </span>
            <span className={m["row-title"]}>{t("my.language")}</span>
            <LanguageButtons className={m.langs} />
          </div>
        </div>
        {user && (
          <Button
            block
            variant="outline"
            className={`border-danger text-danger-text ${m.logout}`}
            loading={out.pending}
            onClick={confirmLogout}
          >
            {t("my.logout")}
          </Button>
        )}
      </div>
    </div>
  );
}
