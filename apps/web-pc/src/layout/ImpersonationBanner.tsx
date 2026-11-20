import { useQueryClient } from "@tanstack/react-query";
import { Button } from "antd";
import { useNavigate } from "react-router-dom";

import { logout } from "../auth/session";
import { useSubmit } from "../hooks/useSubmit";
import { useT } from "../i18n";

/** Shown on every page while an administrator acts as this user (FR-SYS-147); ending it logs
 * the session out (FR-SYS-092) and returns to the login page. */
export function ImpersonationBanner({ name }: { name: string }) {
  const t = useT();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { run, pending } = useSubmit(async () => {
    await logout(queryClient);
    navigate("/login", { replace: true });
  });
  return (
    <div className="pc-impersonation" role="status">
      <strong>{t("impersonate.banner", { name })}</strong>
      <Button size="small" danger loading={pending} onClick={() => void run()} autoInsertSpace={false}>
        {t("impersonate.end")}
      </Button>
    </div>
  );
}
