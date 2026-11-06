import { useQueryClient } from "@tanstack/react-query";
import { Button, Dropdown } from "antd";

import { useT } from "../i18n";
import { refreshTenants, useTenantChoice, type CurrentTenant } from "./useCurrentTenant";
import { useTenant } from "./useTenant";

export function tenantLabel(tenant: CurrentTenant, t: ReturnType<typeof useT>): string {
  return tenant.kind === "organization" ? (tenant.name ?? "") : t("tenant.personal");
}

/** The current tenant in the header; opening the list re-reads the tenants (FR-SYS-096). */
export function TenantSwitcher() {
  const t = useT();
  const queryClient = useQueryClient();
  const { tenant, tenants, setTenant } = useTenant();
  // Not before the list is loaded: it would flash "Personal account" for an org user.
  const loaded = useTenantChoice((s) => s.tenants) !== null;
  if (!tenant || !loaded) return null;
  return (
    <Dropdown
      trigger={["click"]}
      onOpenChange={(open) => {
        if (open) void refreshTenants(queryClient);
      }}
      menu={{
        selectable: true,
        selectedKeys: [String(tenant.tenant_id)],
        items: tenants.map((item) => ({ key: String(item.tenant_id), label: tenantLabel(item, t) })),
        onClick: ({ key }) => {
          const picked = tenants.find((item) => String(item.tenant_id) === key);
          if (picked) setTenant(picked.kind === "organization" ? picked.tenant_id : null);
        },
      }}
    >
      <Button aria-label={t("tenant.switch")}>
        {tenantLabel(tenant, t)}
      </Button>
    </Dropdown>
  );
}
