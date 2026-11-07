// Ported from apps/line-mini/src/features/scan/download.ts without the LINE branch.
import { api, call } from "../services/api";
import type { Lang } from "../stores/language";

/** Export a confirmed result as XLSX and save it from the browser (FR-SYS-131,
 * FR-ENTRY-015). Creating the export reuses a live one and makes a new one when the old
 * one expired; the file is fetched through the api client (tenant header). */
export async function exportAndDownload(jobId: string, language: Lang, fileName: string): Promise<void> {
  const created = await call(
    api.POST("/api/v1/ocr/jobs/{job_id}/exports", { params: { path: { job_id: jobId } }, body: { language } }),
  );
  const blob = (await call(
    api.GET("/api/v1/exports/{export_id}/download", {
      params: { path: { export_id: created.id } },
      parseAs: "blob",
    }),
  )) as Blob;
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${fileName.replace(/\.[^.]+$/, "") || "result"}.xlsx`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
