import { Button, Dialog, List } from "antd-mobile";
import { useNavigate } from "react-router-dom";

import { ErrorText } from "../components/ErrorText";
import { logout, startLogin } from "../features/auth/session";
import { LanguagePicker } from "../features/profile/LanguagePicker";
import { TenantSwitcher } from "../features/tenants/TenantSwitcher";
import { useCurrentTenant } from "../features/tenants/useCurrentTenant";
import { useRequireRegistered } from "../features/auth/useRequireRegistered";
import { useSubmit } from "../hooks/useSubmit";
import { useT } from "../i18n";
import { isUser, useSession } from "../stores/session";

/** "My": identity, login or logout (FR-SYS-041, FR-SYS-043). Profile, language and the
 * entries to organizations, plans and notifications are added by later tasks. */
export function MyPage() {
  const t = useT();
  const navigate = useNavigate();
  const requireRegistered = useRequireRegistered();
  const { tenant } = useCurrentTenant();
  const me = useSession((s) => s.me);
  const loginError = useSession((s) => s.loginError);
  const login = useSubmit(() => startLogin("/my"));
  const out = useSubmit(logout);

  const confirmLogout = async () => {
    const ok = await Dialog.confirm({
      title: t("my.logoutTitle"),
      content: t("my.logoutBody"),
      confirmText: t("common.confirm"),
      cancelText: t("common.cancel"),
    });
    if (ok) await out.run();
  };

  return (
    <div className="page">
      <h1 className="page__title">{t("my.title")}</h1>
      {isUser(me) ? (
        <>
          <List>
            <List.Item
              description={me?.email ?? t("common.notSet")}
              onClick={() => navigate("/profile")}
            >
              {me?.display_name}
            </List.Item>
          </List>
          <TenantSwitcher />
          <List>
            {tenant?.kind === "organization" && (
              <List.Item onClick={() => navigate("/org")}>{t("my.organization")}</List.Item>
            )}
            <List.Item onClick={() => requireRegistered() && navigate("/orgs/apply")}>
              {t("my.createOrg")}
            </List.Item>
          </List>
          <Button block color="danger" fill="outline" loading={out.pending} onClick={confirmLogout}>
            {t("my.logout")}
          </Button>
        </>
      ) : (
        <>
          <List>
            <List.Item description={t("my.guestHint")}>{t("my.guest")}</List.Item>
          </List>
          <Button block color="primary" loading={login.pending} onClick={() => void login.run()}>
            {t("auth.loginRegister")}
          </Button>
          <ErrorText error={loginError} />
        </>
      )}
      <List>
        <List.Item onClick={() => navigate("/plans")}>{t("my.plans")}</List.Item>
      </List>
      <LanguagePicker />
    </div>
  );
}
