import { Layout, Menu, Space, Typography } from "antd";
import { Link, Outlet, useLocation } from "react-router-dom";

import { useMe } from "../auth/session";
import { useT, type MessageKey } from "../i18n";
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
  { key: "org", path: "/org", label: "nav.org" },
  { key: "roles", path: "/roles", label: "nav.roles" },
  { key: "plans", path: "/plans", label: "nav.plans" },
  { key: "notifications", path: "/notifications", label: "nav.notifications" },
  { key: "profile", path: "/profile", label: "nav.profile" },
  { key: "data", path: "/data", label: "nav.data" },
];

function selected(pathname: string): string {
  const match = MENU.filter((m) => m.path !== "/" && pathname.startsWith(m.path));
  return match[0]?.key ?? "home";
}

export function AppLayout({ hidden = [] }: { hidden?: string[] }) {
  const t = useT();
  const location = useLocation();
  const me = useMe();
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
            <LanguageSwitch />
            <Typography.Text strong>{me.data?.display_name}</Typography.Text>
            <LogoutButton />
          </Space>
        </Layout.Header>
        <Layout.Content style={{ padding: 24 }}>
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
