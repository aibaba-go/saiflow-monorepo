import { App, Menu, Spin, Typography } from "antd";
import { useEffect } from "react";
import { Link, Outlet, useLocation } from "react-router-dom";

import { useMe, useMyTenants } from "../auth/session";
import { ErrorText } from "../components/ErrorText";
import { useT, type MessageKey } from "../i18n";
import { BellBadge } from "../notifications/BellBadge";
import { canManageTemplates } from "../templates/common";
import { can } from "../tenants/permissions";
import { TenantSwitcher } from "../tenants/TenantSwitcher";
import { useTenantChoice } from "../tenants/useCurrentTenant";
import { useTenant } from "../tenants/useTenant";
import { Icon, type IconName } from "./icons";
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
  { key: "templates", path: "/templates", label: "nav.templates" },
  { key: "plans", path: "/plans", label: "nav.plans" },
  { key: "notifications", path: "/notifications", label: "nav.notifications" },
  { key: "profile", path: "/profile", label: "nav.profile" },
];

export function selected(pathname: string): string {
  // a document detail is opened from the library, so the library stays selected (prototype)
  if (pathname.startsWith("/documents/")) return "library";
  const match = MENU.find((m) => m.path !== "/" && (pathname === m.path || pathname.startsWith(`${m.path}/`)));
  return match?.key ?? "home";
}

/** The company behind SaiFlow, linked from the sidebar footer (FR-SYS-135). */
export const AIBABA_URL = "https://www.aibaba.asia/";

/** Menu keys under the "workspace" heading; the rest sit under "organization & settings". */
const WORKSPACE = new Set(["home", "upload", "verify", "library", "reviews"]);

const ICONS: Record<string, IconName> = {
  home: "home",
  upload: "upload",
  verify: "verify",
  library: "library",
  reviews: "review",
  reviewSettings: "settings",
  org: "org",
  roles: "users",
  templates: "file",
  plans: "plan",
  notifications: "bell",
  profile: "user",
};

/** The topbar title of a page: its menu item, or "Document detail"; none for unknown paths. */
export function pageTitle(pathname: string): MessageKey | null {
  if (pathname === "/") return "nav.home";
  if (pathname.startsWith("/documents/")) return "layout.documentDetail";
  if (pathname === "/data") return "nav.library";
  const match = MENU.find((m) => m.path !== "/" && (pathname === m.path || pathname.startsWith(`${m.path}/`)));
  return match?.label ?? null;
}

/** Up to two letters of the display name for the avatar (decorative). */
function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const letters = words.length > 1 ? [words[0]!, words[1]!].map((w) => Array.from(w)[0]) : Array.from(words[0] ?? "").slice(0, 2);
  return letters.join("").toUpperCase();
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
    // Templates for the personal account and template_manage holders (FR-SYS-140)
    ...(canManageTemplates(tenant) ? [] : ["templates"]),
  ];
  // The same items, order and permission filter as before; only grouped under two headings.
  const item = (m: MenuItem) => ({
    key: m.key,
    icon: <Icon name={ICONS[m.key] ?? "file"} />,
    label: <Link to={m.path}>{t(m.label)}</Link>,
  });
  const visible = MENU.filter((m) => !hidden.includes(m.key));
  const items = [
    { type: "group" as const, key: "g-work", label: t("layout.navWorkspace"), children: visible.filter((m) => WORKSPACE.has(m.key)).map(item) },
    { type: "group" as const, key: "g-manage", label: t("layout.navManage"), children: visible.filter((m) => !WORKSPACE.has(m.key)).map(item) },
  ].filter((g) => g.children.length > 0);
  const title = pageTitle(location.pathname);
  const name = me.data?.display_name ?? "";
  return (
    <div className="pc-shell">
      <aside className="pc-sidebar">
        <div className="pc-sidebar__lockup">
          <span className="pc-sidebar__mark">
            <Icon name="file" />
          </span>
          <span className="pc-sidebar__product">
            <strong>{t("app.title")}</strong>
            <small>{t("layout.productSubtitle")}</small>
          </span>
        </div>
        <nav className="pc-sidebar__nav" aria-label={t("layout.mainNav")}>
          <Menu theme="dark" mode="inline" selectedKeys={[selected(location.pathname)]} items={items} />
        </nav>
        <div className="pc-sidebar__footer">
          <p className="pc-sidebar__provider">{t("layout.provider")}</p>
          <a
            className="pc-company-link"
            href={AIBABA_URL}
            target="_blank"
            rel="noopener noreferrer"
            aria-label={t("layout.companyLink")}
          >
            <span className="pc-company-link__mark">AIbaba</span>
            <Icon name="arrow" className="pc-company-link__arrow" />
          </a>
          <p className="pc-sidebar__micro">{t("layout.companyTagline")}</p>
        </div>
      </aside>
      <div className="pc-workspace">
        <header className="pc-topbar">
          <nav className="pc-breadcrumb" aria-label={t("layout.breadcrumb")}>
            <span className="pc-breadcrumb__root">{t("app.title")}</span>
            {title && (
              <>
                <Icon name="chevron" className="pc-breadcrumb__sep" />
                <strong className="pc-breadcrumb__page" aria-current="page">
                  {t(title)}
                </strong>
              </>
            )}
          </nav>
          <div className="pc-topbar__tools">
            <TenantSwitcher />
            <span className="pc-topbar__divider" aria-hidden="true" />
            <LanguageSwitch />
            <BellBadge />
            <span className="pc-topbar__divider" aria-hidden="true" />
            <span className="pc-topbar__user">
              {name && (
                <span className="pc-avatar" aria-hidden="true">
                  {initials(name)}
                </span>
              )}
              <Typography.Text strong className="pc-topbar__name">
                {me.data?.display_name}
              </Typography.Text>
            </span>
            <LogoutButton />
          </div>
        </header>
        <main className="pc-content">
          {tenants.isError && !loaded ? <ErrorText error={tenants.error} /> : loaded ? <Outlet /> : <Spin />}
          <footer className="pc-footnote">
            <span>
              <Icon name="info" />
              {t("layout.timeNote")}
            </span>
            <span>{t("layout.footer")}</span>
          </footer>
        </main>
      </div>
    </div>
  );
}
