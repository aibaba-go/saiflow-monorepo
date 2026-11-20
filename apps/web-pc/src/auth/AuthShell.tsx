import type { ReactNode } from "react";

import { useT } from "../i18n";
import { LanguageSwitch } from "../layout/LanguageSwitch";

function HeroIcon({ path }: { path: string }) {
  return (
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d={path} />
    </svg>
  );
}

const POINTS = [
  { key: "login.heroOcr", tone: "teal", icon: "M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8zM14 3v5h5M9 13h6M9 17h4" },
  { key: "login.heroVerify", tone: "emerald", icon: "M20 6 9 17l-5-5" },
  { key: "login.heroReport", tone: "amber", icon: "M4 20V10M10 20V4M16 20v-7M22 20H2" },
] as const;

/** The split layout of the login and reset pages (FR-SYS-090, 155; FR-SYS-132): a brand
 * panel on the left, the form on the right, the language switch on top (FR-SYS-093). */
export function AuthShell({ children }: { children: ReactNode }) {
  const t = useT();
  return (
    <div className="pc-auth pc-auth--split">
      <aside className="pc-auth__hero" aria-hidden="true">
        <div className="pc-auth__brand">
          <span className="pc-auth__mark">S</span>
          <span className="pc-auth__brand-name">SaiFlow</span>
        </div>
        <div className="pc-auth__pitch">
          <h2 className="pc-auth__hero-title">{t("login.heroTitle")}</h2>
          <p className="pc-auth__hero-lead">{t("login.heroLead")}</p>
          <ul className="pc-auth__points">
            {POINTS.map((p) => (
              <li key={p.key}>
                <span className={`pc-auth__chip pc-auth__chip--${p.tone}`}>
                  <HeroIcon path={p.icon} />
                </span>
                {t(p.key)}
              </li>
            ))}
          </ul>
        </div>
        <p className="pc-auth__foot">© {new Date().getFullYear()} SaiFlow · {t("login.heroFooter")}</p>
      </aside>
      <main className="pc-auth__main">
        <div className="pc-auth__lang">
          <LanguageSwitch />
        </div>
        <div className="pc-auth__panel">{children}</div>
      </main>
    </div>
  );
}
