import { Typography } from "antd";
import type { ReactNode } from "react";

import { useT, type MessageKey } from "../i18n";

/** The small uppercase line above each page title (enterprise-ui-redesign, STD-008 §11.3). */
const EYEBROW: Record<string, MessageKey> = {
  home: "eyebrow.home",
  upload: "eyebrow.upload",
  verify: "eyebrow.verify",
  library: "eyebrow.library",
  document: "eyebrow.document",
  reviews: "eyebrow.reviews",
  "review-detail": "eyebrow.reviewDetail",
  "review-settings": "eyebrow.reviewSettings",
  org: "eyebrow.org",
  apply: "eyebrow.org",
  roles: "eyebrow.roles",
  templates: "eyebrow.templates",
  plans: "eyebrow.plans",
  notifications: "eyebrow.notifications",
  profile: "eyebrow.profile",
};

/** The one-line description under the title when a page does not pass its own. */
const DESCRIPTION: Record<string, MessageKey> = {
  home: "layout.desc.home",
  upload: "layout.desc.upload",
  verify: "layout.desc.verify",
  library: "layout.desc.library",
  document: "layout.desc.document",
  reviews: "layout.desc.reviews",
  "review-detail": "layout.desc.reviewDetail",
  "review-settings": "layout.desc.reviewSettings",
  org: "layout.desc.org",
  apply: "layout.desc.apply",
  roles: "layout.desc.roles",
  templates: "layout.desc.templates",
  plans: "layout.desc.plans",
  notifications: "layout.desc.notifications",
  profile: "layout.desc.profile",
};

/** A page heading (eyebrow, title with an optional badge, one-line description; date and
 * actions on the right) and its content, in the branded PC page language (FR-SYS-135). */
export function Page({
  name,
  title,
  description,
  badge,
  meta,
  extra,
  children,
}: {
  name: string;
  title: string;
  description?: string;
  /** e.g. the stage of the open document, next to the title */
  badge?: ReactNode;
  /** quiet information left of the actions, e.g. today's date */
  meta?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
}) {
  const t = useT();
  const eyebrow = EYEBROW[name];
  const desc = description ?? (DESCRIPTION[name] ? t(DESCRIPTION[name]) : undefined);
  return (
    <div data-testid={`page-${name}`} className={`pc-page pc-page--${name}`}>
      <div className="pc-page__heading">
        <div className="pc-page__titles">
          {eyebrow && <p className="pc-page__eyebrow">{t(eyebrow)}</p>}
          <div className="pc-page__title-row">
            <Typography.Title level={1} className="pc-page__title">
              {title}
            </Typography.Title>
            {badge}
          </div>
          {desc && <p className="pc-page__description">{desc}</p>}
        </div>
        {(meta || extra) && (
          <div className="pc-page__extra">
            {meta && <span className="pc-page__meta">{meta}</span>}
            {extra}
          </div>
        )}
      </div>
      {children}
    </div>
  );
}

/** Today in Bangkok, in the current language (heading date label). */
export function TodayLabel() {
  const t = useT();
  const locale = t("format.locale");
  const text = new Intl.DateTimeFormat(locale, {
    timeZone: "Asia/Bangkok",
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "short",
  }).format(new Date());
  return <time className="pc-page__date">{text}</time>;
}
