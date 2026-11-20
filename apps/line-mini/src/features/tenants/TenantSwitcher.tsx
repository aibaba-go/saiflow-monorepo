import { useState, type ReactNode } from "react";

import { useT } from "../../i18n";
import { refreshTenants } from "../auth/session";
import { useSession, type CurrentTenant } from "../../stores/session";
import { useCurrentTenant } from "./useCurrentTenant";
import { Button } from "../../components/ui/button";
import { BottomSheet } from "../../components/ui/sheet";

export function tenantLabel(tenant: CurrentTenant, t: ReturnType<typeof useT>): string {
  return tenant.kind === "organization" ? (tenant.name ?? "") : t("tenant.personal");
}

/** Switch between the personal tenant and the user's organizations (FR-SYS-046). `trigger`
 * draws the opener instead of the default small button (the My page's workspace card); it
 * gets the click handler and the current tenant's label. */
export function TenantSwitcher({
  trigger,
}: {
  trigger?: (props: { onClick(): void; label: string; tenant: CurrentTenant }) => ReactNode;
} = {}) {
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
  const openSheet = () => {
    setOpen(true);
    void refreshTenants();
  };
  const label = t("tenant.current", { name: tenantLabel(tenant, t) });

  return (
    <>
      {trigger ? (
        trigger({ onClick: openSheet, label, tenant })
      ) : (
        <Button size="sm" onClick={openSheet}>
          {label}
        </Button>
      )}
      <BottomSheet open={open} onClose={() => setOpen(false)} label={t("tenant.switch")}>
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
      </BottomSheet>
    </>
  );
}
