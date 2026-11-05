import { Button, Layout, Menu, Space, Typography } from "antd";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";

import { useAdmin, useForgetAdmin } from "../auth/session";
import { useSubmit } from "../hooks/useSubmit";
import { useT, type MessageKey } from "../i18n";
import { api, call } from "../services/api";
import { LanguageSwitch } from "./LanguageSwitch";

/** The console's pages, in menu order. */
export const MENU: { path: string; label: MessageKey }[] = [
  { path: "/", label: "nav.home" },
  { path: "/organization-applications", label: "nav.organizationApplications" },
  { path: "/organizations", label: "nav.organizations" },
  { path: "/verification-applications", label: "nav.verification" },
  { path: "/plan-applications", label: "nav.planApplications" },
  { path: "/plans", label: "nav.plans" },
  { path: "/settings", label: "nav.settings" },
  { path: "/users", label: "nav.users" },
  { path: "/audit-log", label: "nav.auditLog" },
  { path: "/ocr", label: "nav.ocr" },
];

function selected(pathname: string): string {
  const match = MENU.filter((m) => m.path !== "/" && pathname.startsWith(m.path));
  return match[0]?.path ?? "/";
}

export function AdminLayout() {
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const admin = useAdmin();
  const forget = useForgetAdmin();

  const logout = useSubmit(async () => {
    try {
      await call(api.POST("/api/v1/admin/auth/logout"), { own401: true });
    } catch {
      // the session is gone either way
    }
    forget();
    navigate("/login", { replace: true });
  });

  return (
    <Layout style={{ minHeight: "100vh" }}>
      <Layout.Sider breakpoint="lg" collapsedWidth={0} width={220}>
        <div style={{ color: "#fff", padding: 16, fontWeight: 600 }}>{t("app.title")}</div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[selected(location.pathname)]}
          items={MENU.map((m) => ({ key: m.path, label: <Link to={m.path}>{t(m.label)}</Link> }))}
        />
      </Layout.Sider>
      <Layout>
        <Layout.Header
          style={{ background: "#fff", display: "flex", justifyContent: "flex-end", alignItems: "center", paddingInline: 16 }}
        >
          <Space wrap>
            <LanguageSwitch />
            <Typography.Text strong>{admin.data?.username}</Typography.Text>
            <Link to="/password">{t("nav.changePassword")}</Link>
            <Button size="small" loading={logout.pending} onClick={() => void logout.run()}>
              {t("nav.logout")}
            </Button>
          </Space>
        </Layout.Header>
        <Layout.Content style={{ padding: 16 }}>
          <Outlet />
        </Layout.Content>
      </Layout>
    </Layout>
  );
}
