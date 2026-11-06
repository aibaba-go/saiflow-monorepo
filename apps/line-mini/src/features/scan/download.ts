import { apiBaseUrl } from "../../config";
import { api, call } from "../../services/api";
import type { Liff } from "../../services/liffTypes";
import type { Lang } from "../../stores/language";

/** Export a confirmed result as XLSX and download it (FR-SYS-107, FR-ENTRY-015). Creating
 * the export reuses a live one and makes a new one when the old one expired, so the
 * download never meets an expired export. */
export async function exportAndDownload(jobId: string, language: Lang, liff: Liff, fileName: string): Promise<void> {
  const created = await call(
    api.POST("/api/v1/ocr/jobs/{job_id}/exports", { params: { path: { job_id: jobId } }, body: { language } }),
  );
  if (liff.isInClient()) {
    // The LINE in-app browser hands downloads to the system browser, which has no session:
    // a 60-second ticket stands in for it.
    const ticket = await call(
      api.POST("/api/v1/exports/{export_id}/ticket", { params: { path: { export_id: created.id } } }),
    );
    liff.openWindow({ url: new URL(ticket.url, apiBaseUrl || window.location.origin).href, external: true });
    return;
  }
  // Elsewhere: fetched through the api client (the tenant header), saved via an object URL.
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
