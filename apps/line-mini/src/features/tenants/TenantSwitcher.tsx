import { Button, Popup } from "antd-mobile";
import { useState } from "react";

import { useT } from "../../i18n";
import { refreshTenants } from "../auth/session";
import { useSession, type CurrentTenant } from "../../stores/session";
import { useCurrentTenant } from "./useCurrentTenant";

export function tenantLabel(tenant: CurrentTenant, t: ReturnType<typeof useT>): string {
  return tenant.kind === "organization" ? (tenant.name ?? "") : t("tenant.personal");
}

/** Switch between the personal tenant and the user's organizations (FR-SYS-046). */
export function TenantSwitcher() {
  const t = useT();
  const me = useSession((s) => s.me);
  const tenants = useSession((s) => s.tenants);
  const { tenant, setTenant } = useCurrentTenant();
  const [open, setOpen] = useState(false);
  if (me?.kind !== "user" || !tenant) return null;

  const pick = (id: number, kind: string) => {
    setTenant(kind === "organization" ? id : null);
    setOpen(false);
  };

  return (
    <>
      <Button
        size="small"
        onClick={() => {
          setOpen(true);
          void refreshTenants();
        }}
      >
        {t("tenant.current", { name: tenantLabel(tenant, t) })}
      </Button>
      <Popup visible={open} onMaskClick={() => setOpen(false)} bodyStyle={{ padding: 12 }}>
        <div className="section__label">{t("tenant.switch")}</div>
        <div role="listbox" aria-label={t("tenant.switch")} className="choice-list">
          {tenants.map((item) => (
            <button
              key={item.tenant_id}
              type="button"
              role="option"
              aria-selected={item.tenant_id === tenant.tenant_id}
              className="choice-list__item"
              onClick={() => pick(item.tenant_id, item.kind)}
            >
              {tenantLabel(item, t)}
            </button>
          ))}
        </div>
      </Popup>
    </>
  );
}
