import { Button, Result } from "antd";
import { Link } from "react-router-dom";
import type { ReactNode } from "react";

import { useT } from "../i18n";
import { useTenant } from "../tenants/useTenant";

/** Organization pages need an organization as the current tenant (FR-SYS-094-02). */
export function OrgGate({ children }: { children: ReactNode }) {
  const t = useT();
  const { tenant } = useTenant();
  if (tenant?.kind !== "organization") return (
      <Result
        status="info"
        title={t("org.none")}
        extra={
          <Link to="/org/apply">
            <Button>{t("org.createHint")}</Button>
          </Link>
        }
      />
    );
  return <>{children}</>;
}
