import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";

import { logout } from "../auth/session";
import { ConfirmButton } from "../components/ConfirmButton";
import { useT } from "../i18n";

/** Log out after confirming; back to the login page whatever the backend says (FR-SYS-092). */
export function LogoutButton() {
  const t = useT();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  return (
    <ConfirmButton
      label={t("my.logout")}
      title={`${t("my.logoutTitle")} ${t("pc.logoutBody")}`}
      onConfirm={async () => {
        await logout(queryClient);
        navigate("/login", { replace: true });
      }}
    />
  );
}
