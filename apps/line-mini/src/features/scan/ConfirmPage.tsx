import { Button, NavBar } from "antd-mobile";
import { useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";

import { BrandLoading } from "../../components/BrandLoading";
import { ErrorText } from "../../components/ErrorText";
import { OriginalPreview } from "../../components/OriginalPreview";
import { useT } from "../../i18n";
import type { ApiError } from "../../services/errors";
import { useCreateJobs, usePending } from "./jobs";

/** Preview the chosen pending originals, then create their jobs in order on one tap
 * (FR-SYS-058). Quota and plan failures get their own message; anything unclear is
 * retried by hand with the same keys (AC-058-03). */
export function ConfirmPage() {
  const t = useT();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const pending = usePending();
  const create = useCreateJobs();
  const [error, setError] = useState<ApiError | null>(null);
  const [started, setStarted] = useState(0);
  const [total, setTotal] = useState(0);
  const ids = useMemo(() => (params.get("ids") ?? "").split(",").filter(Boolean), [params]);
  const files = (pending.data ?? [])
    .filter((f) => ids.includes(f.id))
    .sort((a, b) => ids.indexOf(a.id) - ids.indexOf(b.id));

  async function start() {
    setError(null);
    setTotal(started + files.length);
    const result = await create.run(files);
    const count = started + result.jobs.length;
    setStarted(count);
    if (result.error) {
      setError(result.error);
      return;
    }
    const first = result.jobs[0];
    if (first && count === 1) navigate(`/scan/jobs/${first.id}/progress`, { replace: true });
    else navigate("/history", { replace: true });
  }

  const quota = error?.code === "quota_exceeded";
  const expired = error?.code === "plan_expired";
  return (
    <div className="page">
      <NavBar onBack={() => navigate("/")}>{t("scan.confirmTitle")}</NavBar>
      {pending.isPending && <BrandLoading variant="inline" label={t("common.loading")} />}
      {pending.isError && <ErrorText error={pending.error} />}
      {files.map((file) => (
        <div key={file.id} data-confirm={file.original_name}>
          <div className="section__label">
            {file.original_name} · {t("scan.pages", { n: file.page_count ?? 1 })}
          </div>
          <OriginalPreview
            fileId={file.id}
            fileName={file.original_name}
            pageCount={file.page_count ?? 1}
          />
        </div>
      ))}
      {quota && (
        <div role="alert" className="field-error">
          {t("scan.quotaLeft", { n: Number(error.details?.available ?? 0) })}
        </div>
      )}
      {expired && (
        <>
          <ErrorText error={error} />
          <Button onClick={() => navigate("/plans")}>{t("scan.toPlans")}</Button>
        </>
      )}
      {error && !quota && !expired && <ErrorText error={error} />}
      {error && started > 0 && (
        <div className="usage__hint">{t("scan.partial", { n: started, total })}</div>
      )}
      {pending.isSuccess && (
        <Button
          block
          color="primary"
          loading={create.pending}
          disabled={!files.length}
          onClick={() => void start()}
        >
          {error && !quota && !expired ? t("common.retry") : t("scan.start")}
        </Button>
      )}
    </div>
  );
}
