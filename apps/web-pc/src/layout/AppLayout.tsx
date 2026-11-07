import { App, Layout, Menu, Space, Spin, Typography } from "antd";
import { useEffect } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";

import { useMe, useMyTenants } from "../auth/session";
import { ErrorText } from "../components/ErrorText";
import { useT, type MessageKey } from "../i18n";
import { BellBadge } from "../notifications/BellBadge";
import { can } from "../tenants/permissions";
import { TenantSwitcher } from "../tenants/TenantSwitcher";
import { useTenantChoice } from "../tenants/useCurrentTenant";
import { useTenant } from "../tenants/useTenant";
import { LanguageSwitch } from "./LanguageSwitch";
import { LogoutButton } from "./LogoutButton";

export interface MenuItem {
  key: string;
  path: string;
  label: MessageKey;
}

/** The pages, in menu order (FR-SYS-094, A4). */
export const MENU: MenuItem[] = [
  { key: "home", path: "/", label: "nav.home" },
  { key: "upload", path: "/upload", label: "nav.upload" },
  { key: "verify", path: "/verify", label: "nav.verify" },
  { key: "library", path: "/library", label: "nav.library" },
  { key: "reviews", path: "/reviews", label: "nav.reviews" },
  { key: "reviewSettings", path: "/review-settings", label: "nav.reviewSettings" },
  { key: "org", path: "/org", label: "nav.org" },
  { key: "roles", path: "/roles", label: "nav.roles" },
  { key: "plans", path: "/plans", label: "nav.plans" },
  { key: "notifications", path: "/notifications", label: "nav.notifications" },
  { key: "profile", path: "/profile", label: "nav.profile" },
];

function selected(pathname: string): string {
  const match = MENU.filter((m) => m.path !== "/" && pathname.startsWith(m.path));
  return match[0]?.key ?? "home";
}

/** Keep the tenant list in the tenant store and show its one-off notice (AC-096-03). */
function useTenantsLoader(userId: number | null | undefined) {
  const tenants = useMyTenants();
  const bindUser = useTenantChoice((s) => s.bindUser);
  const setTenants = useTenantChoice((s) => s.setTenants);
  const notice = useTenantChoice((s) => s.notice);
  const clearNotice = useTenantChoice((s) => s.clearNotice);
  const { message } = App.useApp();
  const t = useT();
  useEffect(() => {
    if (!userId || !tenants.data) return;
    bindUser(userId);
    setTenants(tenants.data);
  }, [userId, tenants.data, bindUser, setTenants]);
  useEffect(() => {
    if (!notice) return;
    void message.warning(t(notice));
    clearNotice();
  }, [notice, clearNotice, message, t]);
  return tenants;
}

export function AppLayout() {
  const t = useT();
  const location = useLocation();
  const me = useMe();
  const tenants = useTenantsLoader(me.data?.user_id);
  const loaded = useTenantChoice((s) => s.tenants) !== null;
  const { tenant } = useTenant();
  // Roles only in an organization, for those holding role management; Reviews for holders
  // of a review permission; Review settings for the owner (FR-SYS-094).
  const org = tenant?.kind === "organization";
  const hidden = [
    ...(can(tenant, "upload_ocr") ? [] : ["upload"]),
    ...(can(tenant, "verify_own") || can(tenant, "verify_others") ? [] : ["verify"]),
    ...(org && can(tenant, "role_manage") ? [] : ["roles"]),
    ...(org && (can(tenant, "review_l1") || can(tenant, "review_l2")) ? [] : ["reviews"]),
    ...(org && tenant.is_owner ? [] : ["reviewSettings"]),
  ];
  return (
    <Layout style={{ minHeight: "100vh", minWidth: 1280 }}>
      <Layout.Sider width={220}>
        <div style={{ color: "#fff", padding: 16, fontWeight: 600 }}>{t("app.title")}</div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selected(location.pathname)]}
          items={MENU.filter((m) => !hidden.includes(m.key)).map((m) => ({
            key: m.key,
            label: <Link to={m.path}>{t(m.label)}</Link>,
          }))}
        />
      </Layout.Sider>
      <Layout>
        <Layout.Header
          style={{ background: "#fff", display: "flex", justifyContent: "flex-end", alignItems: "center", paddingInline: 16 }}
        >
          <Space size="middle">
            <TenantSwitcher />
            <BellBadge />
            <LanguageSwitch />
            <Typography.Text strong>{me.data?.display_name}</Typography.Text>
            <LogoutButton />
          </Space>
        </Layout.Header>
        <Layout.Content style={{ padding: 24 }}>
          {tenants.isError && !loaded ? <ErrorText error={tenants.error} /> : loaded ? <Outlet /> : <Spin />}
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
