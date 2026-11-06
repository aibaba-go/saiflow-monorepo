import { Button, NavBar } from "antd-mobile";
import { useState } from "react";
import { useNavigate, useParams } from "react-router-dom";

import { BrandLoading } from "../../components/BrandLoading";
import { ErrorText } from "../../components/ErrorText";
import { OriginalPreview } from "../../components/OriginalPreview";
import { useT } from "../../i18n";
import { useLanguage } from "../../stores/language";
import { authLiff } from "../auth/session";
import { can } from "../tenants/permissions";
import { useCurrentTenant } from "../tenants/useCurrentTenant";
import { exportAndDownload } from "./download";
import { useJob } from "./ProcessingPage";
import { useResult } from "./ResultPage";
import { StructuredEditor } from "./StructuredEditor";
import type { Group, Json } from "./structured";

/** The confirmed result, read only, with the original and "Export Excel" for holders of
 * the export permission (FR-SYS-107). */
export function FinalResultPage() {
  const t = useT();
  const navigate = useNavigate();
  const lang = useLanguage((s) => s.lang);
  const { tenant } = useCurrentTenant();
  const { id = "" } = useParams();
  const job = useJob(id, false);
  const result = useResult(id);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const data = result.data;

  async function download() {
    setBusy(true);
    setError(null);
    try {
      await exportAndDownload(id, lang, authLiff(), job.data?.file_name ?? "result");
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="page">
      <NavBar onBack={() => navigate("/history")}>{data?.template?.name ?? t("scan.finalTitle")}</NavBar>
      {job.data && (
        <OriginalPreview fileId={job.data.file_id} fileName={job.data.file_name} pageCount={job.data.page_count} />
      )}
      {result.isPending && <BrandLoading variant="inline" label={t("common.loading")} />}
      {result.isError && <ErrorText error={result.error} />}
      {data && (
        <>
          <div role="status" className="scan__ok">
            {t("scan.confirmedNote")}
          </div>
          <StructuredEditor
            value={(data.structured ?? {}) as Json}
            groups={(data.template?.groups ?? null) as Group[] | null}
            missing={new Set()}
            onChange={() => {}}
            readOnly
          />
        </>
      )}
      <ErrorText error={error} />
      {data && can(tenant, "export") && (
        <Button block color="primary" loading={busy} onClick={() => void download()}>
          {t("scan.exportExcel")}
        </Button>
      )}
    </div>
  );
}
