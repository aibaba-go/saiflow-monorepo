import { Button, Result, Spin } from "antd";
import type { ReactNode } from "react";
import { Navigate, useLocation } from "react-router-dom";

import { useT } from "../i18n";
import { errorMessage } from "../services/errors";
import { loginPath, useAdmin } from "./session";

/** Pages behind login: no session → /login?next=<this page> (FR-SYS-060-03). */
export function RequireAdmin({ children }: { children: ReactNode }) {
  const t = useT();
  const location = useLocation();
  const admin = useAdmin();
  if (admin.isPending) return <Spin style={{ display: "block", marginTop: 120 }} />;
  if (admin.isError) {
    return (
      <Result
        status="error"
        title={errorMessage(admin.error, t)}
        extra={<Button onClick={() => admin.refetch()}>{t("common.retry")}</Button>}
      />
    );
  }
  if (!admin.data) return <Navigate to={loginPath(location)} replace />;
  return <>{children}</>;
}
