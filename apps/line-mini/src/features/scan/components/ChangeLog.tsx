import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { BrandLoading } from "../../../components/BrandLoading";
import { useT } from "../../../i18n";
import { errorMessage } from "../../../services/errors";
import { useLanguage } from "../../../stores/language";
import { formatBangkokDateTime } from "../../../utils/format";
import { listChanges } from "../../reviews/api";
import { useCurrentTenant } from "../../tenants/useCurrentTenant";
import { changeLabel } from "../changeLabel";
import type { Group } from "../structured";
import cl from "./ChangeLog.module.css";
import { FormDialog, fd } from "./FormDialog";

function show(value: unknown, empty: string): string {
  if (value === null || value === undefined || value === "") return empty;
  return typeof value === "string" ? value : JSON.stringify(value);
}

/** "Change log" button and its list (FR-SYS-122): every saved change oldest first, with
 * before → after, who and when; a template switch as one line. Loaded when opened. */
export function ChangeLog({ jobId, groups, variant = "button" }: { jobId: string; groups: Group[] | null; variant?: "button" | "link" }) {
  const t = useT();
  const lang = useLanguage((s) => s.lang);
  const { tenant } = useCurrentTenant();
  const [open, setOpen] = useState(false);
  const changes = useQuery({
    queryKey: ["changes", tenant?.tenant_id, jobId],
    queryFn: () => listChanges(jobId),
    enabled: open,
  });
  const empty = t("review.changes.empty_value");
  const generic = t("review.changes.generic");
  return (
    <>
      {variant === "link" ? (
        // prototype .link-row: a quiet row with the history mark at the end
        <button type="button" className={cl["link-row"]} onClick={() => setOpen(true)}>
          <span>{t("review.changes")}</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M3 12a9 9 0 1 0 3-6.7" />
            <path d="M3 4v4h4" />
            <path d="M12 8v4l3 2" />
          </svg>
        </button>
      ) : (
        <button type="button" className={`${fd["fd-btn"]} ${fd.secondary}`} onClick={() => setOpen(true)}>
          {t("review.changes")}
        </button>
      )}
      {open && (
        <FormDialog title={t("review.changes")}>
          {changes.isPending ? (
            <BrandLoading variant="inline" label={t("common.loading")} />
          ) : changes.isError ? (
            <p>{errorMessage(changes.error, t)}</p>
          ) : !changes.data.length ? (
            <p>{t("review.changes.empty")}</p>
          ) : (
            <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 10 }}>
              {changes.data.map((c, i) => (
                <li key={i} style={{ fontSize: 12, lineHeight: 1.5 }}>
                  {c.kind === "TEMPLATE" ? (
                    <div style={{ fontWeight: 700 }}>
                      {t("review.changes.template", {
                        from: c.from_template ?? generic,
                        to: c.to_template ?? generic,
                      })}
                    </div>
                  ) : (
                    <>
                      <div style={{ fontWeight: 700 }}>{changeLabel(c.path ?? "", groups, t, lang)}</div>
                      <div>
                        {show(c.before, empty)} → {show(c.after, empty)}
                      </div>
                    </>
                  )}
                  <div style={{ color: "var(--text-secondary)" }}>
                    {c.user_name ?? "-"} · {formatBangkokDateTime(c.created_at)}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <div className={fd["fd-actions"]}>
            <button type="button" className={`${fd["fd-btn"]} ${fd.primary}`} onClick={() => setOpen(false)}>
              {t("common.ok")}
            </button>
          </div>
        </FormDialog>
      )}
    </>
  );
}
