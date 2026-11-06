import { useQuery } from "@tanstack/react-query";
import { Button, Popup } from "antd-mobile";
import { useState } from "react";

import { ErrorText } from "../../components/ErrorText";
import { useT } from "../../i18n";
import { api, call } from "../../services/api";

/** Published templates and the generic result (FR-OCR-019, 020). onBeforeSwitch saves the
 * draft first (AC-FR-SYS-105-02); a failed save stops the switch. */
export function TemplatePicker({ jobId, open, onClose, onBeforeSwitch, onSwitched }: {
  jobId: string;
  open: boolean;
  onClose(): void;
  onBeforeSwitch(): Promise<boolean>;
  onSwitched(): void;
}) {
  const t = useT();
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const options = useQuery({
    queryKey: ["template-options", jobId],
    queryFn: () =>
      call(api.GET("/api/v1/ocr/jobs/{job_id}/template-options", { params: { path: { job_id: jobId } } })),
    enabled: open,
  });

  async function choose(versionId: number | null) {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (!(await onBeforeSwitch())) return;
      const path = { params: { path: { job_id: jobId } } };
      if (versionId === null) await call(api.POST("/api/v1/ocr/jobs/{job_id}/generic", path));
      else
        await call(
          api.POST("/api/v1/ocr/jobs/{job_id}/template", { ...path, body: { template_version_id: versionId } }),
        );
      onSwitched();
      onClose();
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const data = options.data;
  return (
    <Popup visible={open} onMaskClick={onClose} bodyStyle={{ maxHeight: "70vh", overflow: "auto" }}>
      <div className="form" style={{ padding: 16 }}>
        <div className="form__title">{t("scan.changeTemplate")}</div>
        <ErrorText error={options.error ?? error} />
        {data && (
          <>
            <div className="usage__hint">{t("scan.attempts", { n: data.attempts, limit: data.limit })}</div>
            <div className="picker__list">
              {data.templates.map((tpl) => {
                const current = tpl.template_version_id === data.current_template_version_id;
                return (
                  <Button
                    key={tpl.template_version_id}
                    block
                    fill={current ? "solid" : "outline"}
                    color={current ? "primary" : "default"}
                    disabled={busy}
                    aria-pressed={current}
                    onClick={() => void choose(tpl.template_version_id)}
                  >
                    {tpl.name}
                    {current && ` · ${t("scan.current")}`}
                  </Button>
                );
              })}
              {data.generic && (
                <Button block fill="outline" disabled={busy} onClick={() => void choose(null)}>
                  {t("scan.generic")}
                </Button>
              )}
            </div>
          </>
        )}
      </div>
    </Popup>
  );
}
