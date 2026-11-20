import { Typography } from "antd";
import type { ReactNode } from "react";

import { useT } from "../i18n";

/** The console pages that carry a branded heading (their eyebrow and description keys). */
export type PageName =
  | "home"
  | "organizationApplications"
  | "organizations"
  | "organization"
  | "verification"
  | "planApplications"
  | "billing"
  | "plans"
  | "settings"
  | "users"
  | "auditLog"
  | "ocr"
  | "templates"
  | "template"
  | "reports"
  | "report"
  | "password";

/** A console page in the branded PC page language (enterprise-ui-redesign, FR-SYS-135,
 * FR-SYS-138): a small uppercase eyebrow, the title as the page heading, a one-line
 * description and the actions on the right, then the content. */
export function Page({
  name,
  title,
  extra,
  children,
}: {
  name: PageName;
  title: string;
  extra?: ReactNode;
  children?: ReactNode;
}) {
  const t = useT();
  return (
    <section data-testid={`page-${name}`} className={`ad-page ad-page--${name}`}>
      <div className="ad-page__heading">
        <div className="ad-page__titles">
          <p className="ad-page__eyebrow">{t(`page.${name}.eyebrow`)}</p>
          <Typography.Title level={1} className="ad-page__title">
            {title}
          </Typography.Title>
          <p className="ad-page__description">{t(`page.${name}.description`)}</p>
        </div>
        {extra && <div className="ad-page__extra">{extra}</div>}
      </div>
      {children}
    </section>
  );
}
