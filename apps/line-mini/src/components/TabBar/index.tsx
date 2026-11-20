import { ChartColumn, LayoutGrid, RotateCcwClock, UserRound, type LucideIcon } from "lucide-react";
import { useLocation, useNavigate } from "react-router-dom";

import { useT, type MessageKey } from "../../i18n";
import "./tabbar.css";

export interface TabBarProps {
  showReport: boolean;
}

const TABS: { path: string; label: MessageKey; icon: LucideIcon; report?: boolean }[] = [
  { path: "/", label: "nav.home", icon: LayoutGrid },
  { path: "/history", label: "nav.history", icon: RotateCcwClock },
  { path: "/report", label: "nav.report", icon: ChartColumn, report: true },
  { path: "/my", label: "nav.my", icon: UserRound },
];

/** Bottom navigation: Home / History / Report (only for some users, D7) / My (FR-SYS-056). */
export function TabBar({ showReport }: TabBarProps) {
  const t = useT();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  return (
    <nav className="tabbar">
      <div role="tablist" className="tabbar__list">
        {TABS.filter((tab) => !tab.report || showReport).map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.path}
              role="tab"
              type="button"
              aria-selected={pathname === tab.path}
              className="tabbar__tab"
              onClick={() => navigate(tab.path)}
            >
              <span className="tabbar__icon" aria-hidden="true">
                <Icon size={21} strokeWidth={1.75} />
              </span>
              <span className="tabbar__label">{t(tab.label)}</span>
            </button>
          );
        })}
      </div>
    </nav>
  );
}
