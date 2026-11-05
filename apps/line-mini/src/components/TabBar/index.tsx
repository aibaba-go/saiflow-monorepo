import { useLocation, useNavigate } from "react-router-dom";

import { useT, type MessageKey } from "../../i18n";
import "./tabbar.css";

export interface TabBarProps {
  showReport: boolean;
}

const TABS: { path: string; label: MessageKey; report?: boolean }[] = [
  { path: "/", label: "nav.home" },
  { path: "/history", label: "nav.history" },
  { path: "/report", label: "nav.report", report: true },
  { path: "/my", label: "nav.my" },
];

/** Bottom navigation: Home / History / Report (only for some users, D7) / My (FR-SYS-056). */
export function TabBar({ showReport }: TabBarProps) {
  const t = useT();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return (
    <nav className="tabbar">
      <div role="tablist" className="tabbar__list">
        {TABS.filter((tab) => !tab.report || showReport).map((tab) => (
          <button
            key={tab.path}
            role="tab"
            type="button"
            aria-selected={pathname === tab.path}
            className="tabbar__tab"
            onClick={() => navigate(tab.path)}
          >
            {t(tab.label)}
          </button>
        ))}
      </div>
    </nav>
  );
}
