import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { useT } from "../../../i18n";
import { useLanguage } from "../../../stores/language";
import { errorMessage } from "../../../services/errors";
import { templateOptions, templateVersion } from "../api";
import rs from "../ResultPage.module.css";
import { label, type Group } from "../structured";
import { FormDialog, fd } from "./FormDialog";

export type SwitchTarget = number | "generic";

function Preview({ versionId }: { versionId: number }) {
  const t = useT();
  const lang = useLanguage((s) => s.lang);
  const q = useQuery({ queryKey: ["template-version", versionId], queryFn: () => templateVersion(versionId) });
  if (q.isError) return <p role="alert">{errorMessage(q.error, t)}</p>;
  if (!q.data) return <span>{t("common.loading")}</span>;
  return (
    <>
      {(q.data.groups as unknown as Group[]).map((group) => (
        <div key={group.key} className={rs["template-preview"]}>
          <b>{label(group, lang)}</b>
          {group.items.map((item) => (
            <div key={item.key}>
              {label(item, lang)}
              {item.kind === "field" && item.required && <span> *</span>}
              {item.kind === "table" && (
                <small> {(item.columns ?? []).map((c) => label(c, lang) + (c.required ? " *" : "")).join(" · ")}</small>
              )}
            </div>
          ))}
        </div>
      ))}
    </>
  );
}

/** main ResultPage's template selector (FR-SYS-115, FR-OCR-024): templates by score with
 * "Recommended" and the score, field preview before applying, the generic result. */
export function TemplatePanel({ jobId, current, onClose, onApply }: {
  jobId: string;
  current: SwitchTarget;
  onClose(): void;
  onApply(target: SwitchTarget): void;
}) {
  const t = useT();
  const [target, setTarget] = useState<SwitchTarget>(current);
  const [open, setOpen] = useState<Record<number, boolean>>({});
  const options = useQuery({ queryKey: ["template-options", jobId], queryFn: () => templateOptions(jobId) });
  const data = options.data;
  return (
    <FormDialog title={t("template.choose")}>
      {options.isError && <p className={fd["fd-error"]}>{errorMessage(options.error, t)}</p>}
      {data && !data.templates.length && <p className={rs["template-notice"]}>{t("template.none")}</p>}
      {data?.templates.map((o) => (
        <div key={o.template_version_id} className={rs["template-option"]}>
          <label>
            <input
              type="radio"
              name="template"
              checked={target === o.template_version_id}
              onChange={() => setTarget(o.template_version_id)}
            />
            <span>
              {o.name}
              {o.recommended && <small> {t("template.recommended")}</small>}
              {o.score !== null && o.score !== undefined && <small> {Math.round(o.score * 100)}%</small>}
            </span>
          </label>
          <details
            onToggle={(e) => {
              if ((e.target as HTMLDetailsElement).open) setOpen({ ...open, [o.template_version_id]: true });
            }}
          >
            <summary>{t("template.preview")}</summary>
            {open[o.template_version_id] && <Preview versionId={o.template_version_id} />}
          </details>
        </div>
      ))}
      <label className={rs["template-option"]}>
        <input type="radio" name="template" checked={target === "generic"} onChange={() => setTarget("generic")} />{" "}
        {t("template.generic")}
      </label>
      <div className={fd["fd-actions"]}>
        <button type="button" className={`${fd["fd-btn"]} ${fd.secondary}`} onClick={onClose}>
          {t("common.cancel")}
        </button>
        <button type="button" className={`${fd["fd-btn"]} ${fd.primary}`} onClick={() => onApply(target)}>
          {t("template.apply")}
        </button>
      </div>
    </FormDialog>
  );
}
