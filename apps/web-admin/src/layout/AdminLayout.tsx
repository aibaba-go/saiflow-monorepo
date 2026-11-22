import { Button, Menu, Typography } from "antd";
import { useState } from "react";
import { Link, Outlet, useLocation, useNavigate } from "react-router-dom";

import { useAdmin, useForgetAdmin } from "../auth/session";
import { useSubmit } from "../hooks/useSubmit";
import { useT, type MessageKey } from "../i18n";
import { api, call } from "../services/api";
import { Icon, type IconName } from "./icons";
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
  { path: "/templates", label: "nav.templates" },
  { path: "/reports", label: "nav.reports" },
  { path: "/data-sources", label: "nav.dataSources" },
];

/** The company behind SaiFlow, linked from the sidebar footer (FR-SYS-135). */
export const AIBABA_URL = "https://www.aibaba.asia/";

/** Menu paths under the "operations" heading; the rest, in the same order, sit under
 * "platform". The headings only group the unchanged menu (FR-SYS-138). */
const OPERATIONS = new Set(["/", "/organization-applications", "/organizations", "/verification-applications", "/plan-applications"]);

const ICONS: Record<string, IconName> = {
  "/": "home",
  "/organization-applications": "inbox",
  "/organizations": "org",
  "/verification-applications": "review",
  "/plan-applications": "receipt",
  "/plans": "plan",
  "/settings": "settings",
  "/users": "users",
  "/audit-log": "history",
  "/ocr": "spark",
  "/templates": "template",
  "/reports": "chart",
  "/data-sources": "template",
};

function selected(pathname: string): string {
  const match = MENU.filter((m) => m.path !== "/" && pathname.startsWith(m.path));
  return match[0]?.path ?? "/";
}

/** The topbar page name: its menu item, or the page reached from one; none when unknown. */
export function pageTitle(pathname: string): MessageKey | null {
  if (pathname === "/") return "nav.home";
  if (pathname === "/password") return "nav.changePassword";
  if (/^\/tenants\/[^/]+\/billing$/.test(pathname)) return "org.billing";
  const match = MENU.find((m) => m.path !== "/" && (pathname === m.path || pathname.startsWith(`${m.path}/`)));
  return match?.label ?? null;
}

/** Up to two letters of the username for the avatar (decorative). */
function initials(name: string): string {
  return Array.from(name.trim()).slice(0, 2).join("").toUpperCase();
}

export function AdminLayout() {
  const t = useT();
  const location = useLocation();
  const navigate = useNavigate();
  const admin = useAdmin();
  const forget = useForgetAdmin();
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem("saiflow.admin.menuCollapsed") === "true"; }
    catch { return false; }
  });
  const toggleMenu = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem("saiflow.admin.menuCollapsed", String(next)); }
    catch { /* Storage may be blocked by the browser. */ }
  };

  const logout = useSubmit(async () => {
    try {
      await call(api.POST("/api/v1/admin/auth/logout"), { own401: true });
    } catch {
      // the session is gone either way
    }
    forget();
    navigate("/login", { replace: true });
  });

  const item = (m: (typeof MENU)[number]) => ({
    key: m.path,
    icon: <Icon name={ICONS[m.path] ?? "home"} />,
    title: t(m.label),
    label: <Link to={m.path} aria-label={collapsed ? t(m.label) : undefined} title={collapsed ? t(m.label) : undefined}>{t(m.label)}</Link>,
  });
  const items = [
    { type: "group" as const, key: "g-ops", label: t("layout.navOperations"), children: MENU.filter((m) => OPERATIONS.has(m.path)).map(item) },
    { type: "group" as const, key: "g-platform", label: t("layout.navPlatform"), children: MENU.filter((m) => !OPERATIONS.has(m.path)).map(item) },
  ];
  const title = pageTitle(location.pathname);
  const name = admin.data?.username ?? "";

  return (
    <div className={`ad-shell${collapsed ? " ad-shell--collapsed" : ""}`}>
      <aside className="ad-sidebar" aria-label={t("layout.sidebar")}>
        <div className="ad-sidebar__lockup">
          <span className="ad-sidebar__mark">
            <Icon name="shield" />
          </span>
          <span className="ad-sidebar__product">
            <strong>{t("layout.brand")}</strong>
            <small>{t("layout.subtitle")}</small>
          </span>
        </div>
        <nav id="admin-main-navigation" className="ad-sidebar__nav" aria-label={t("layout.mainNav")}>
          <Menu theme="dark" mode="inline" selectedKeys={[selected(location.pathname)]} items={items} />
        </nav>
        <div className="ad-sidebar__footer">
          <p className="ad-sidebar__provider">{t("layout.provider")}</p>
          <a
            className="ad-company-link"
            href={AIBABA_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("layout.companyLink")}
          >
            <span className="ad-company-link__mark">AIbaba</span>
            <Icon name="arrow" className="ad-company-link__arrow" />
          </a>
          <p className="ad-sidebar__micro">{t("layout.companyTagline")}</p>
        </div>
      </aside>
      <div className="ad-workspace">
        <header className="ad-topbar">
          <div className="ad-topbar__start">
          <Button className={`ad-menu-toggle${collapsed ? " ad-menu-toggle--collapsed" : ""}`} aria-label={t(collapsed ? "layout.expandMenu" : "layout.collapseMenu")} title={t(collapsed ? "layout.expandMenu" : "layout.collapseMenu")} aria-expanded={!collapsed} aria-controls="admin-main-navigation" onClick={toggleMenu} icon={<Icon name="chevron" />} />
          <nav className="ad-breadcrumb" aria-label={t("layout.breadcrumb")}>
            <span className="ad-breadcrumb__root">{t("app.title")}</span>
            {title && (
              <>
                <Icon name="chevron" className="ad-breadcrumb__sep" />
                <strong className="ad-breadcrumb__page" aria-current="page">
                  {t(title)}
                </strong>
              </>
            )}
          </nav>
          </div>
          <div className="ad-topbar__tools">
            <LanguageSwitch />
            <span className="ad-topbar__divider" aria-hidden="true" />
            <span className="ad-topbar__user">
              {name && (
                <span className="ad-avatar" aria-hidden="true">
                  {initials(name)}
                </span>
              )}
              <Typography.Text strong className="ad-topbar__name">
                {admin.data?.username}
              </Typography.Text>
            </span>
            <Link to="/password" className="ad-topbar__link">
              <Icon name="key" />
              {t("nav.changePassword")}
            </Link>
            <Button loading={logout.pending} onClick={() => void logout.run()}>
              {t("nav.logout")}
            </Button>
          </div>
        </header>
        <main className="ad-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
