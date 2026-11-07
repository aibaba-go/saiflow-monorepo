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
import { confirmAction } from "../utils/confirm";
import { Button } from "../components/ui/button";
import { ListGroup, ListItem } from "../components/ui/list";

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
    const ok = await confirmAction(t, t("my.logoutTitle"), t("my.logoutBody"));
    if (ok) await out.run();
  };

  return (
    <div className="page">
      <h1 className="page__title">{t("my.title")}</h1>
      {isUser(me) ? (
        <>
          <ListGroup>
            <ListItem
              description={me?.email ?? t("common.notSet")}
              onClick={() => navigate("/profile")}
            >
              {me?.display_name}
            </ListItem>
          </ListGroup>
          <TenantSwitcher />
          <ListGroup>
            {tenant?.kind === "organization" && (
              <ListItem onClick={() => navigate("/org")}>{t("my.organization")}</ListItem>
            )}
            <ListItem onClick={() => requireRegistered() && navigate("/orgs/apply")}>
              {t("my.createOrg")}
            </ListItem>
          </ListGroup>
          <Button block variant="outline" className="border-danger text-danger-text" loading={out.pending} onClick={confirmLogout}>
            {t("my.logout")}
          </Button>
        </>
      ) : (
        <>
          <ListGroup>
            <ListItem description={t("my.guestHint")}>{t("my.guest")}</ListItem>
          </ListGroup>
          <Button block variant="primary" loading={login.pending} onClick={() => void login.run()}>
            {t("auth.loginRegister")}
          </Button>
          <ErrorText error={loginError} />
        </>
      )}
      <ListGroup>
        <ListItem onClick={() => navigate("/plans")}>{t("my.plans")}</ListItem>
        {isUser(me) && (
          <ListItem onClick={() => navigate("/notifications")}>{t("notif.title")}</ListItem>
        )}
      </ListGroup>
      <LanguagePicker />
    </div>
  );
}
