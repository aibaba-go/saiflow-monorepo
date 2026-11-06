import { Result } from "antd";
import type { ReactNode } from "react";

import { useT } from "../i18n";
import { useTenant } from "../tenants/useTenant";

/** Organization pages need an organization as the current tenant (FR-SYS-094-02). */
export function OrgGate({ children }: { children: ReactNode }) {
  const t = useT();
  const { tenant } = useTenant();
  if (tenant?.kind !== "organization") return <Result status="info" title={t("org.none")} />;
  return <>{children}</>;
}
