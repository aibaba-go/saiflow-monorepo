import { apiBaseUrl } from "../../config";
import { api, call } from "../../services/api";
import type { Liff } from "../../services/liffTypes";
import type { Lang } from "../../stores/language";

const XLSX_TYPE = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** How an XLSX export went: prepared inside LINE for the share sheet, or saved
 *  directly from another browser (FR-SYS-107, FR-ENTRY-015). `exportId` lets the user
 *  still choose the phone browser for the prepared file. */
export type XlsxOutcome = { how: "prepared"; file: File; exportId: string } | { how: "saved" };

/** Export a confirmed result as XLSX (FR-SYS-107, FR-ENTRY-015). Creating the export
 *  reuses a live one and makes a new one when the old one expired, so the download
 *  never meets an expired export.
 *
 *  Inside LINE the file is fetched with the session and kept in the page: the caller hands
 *  it to the share sheet from a tap, so LINE does not ask to open an external app. On
 *  other browsers it is saved directly via a download link. */
export async function exportAndDownload(
  jobId: string,
  language: Lang,
  liff: Liff,
  fileName: string,
): Promise<XlsxOutcome> {
  const created = await call(
    api.POST("/api/v1/ocr/jobs/{job_id}/exports", {
      params: { path: { job_id: jobId } },
      body: { language },
    }),
  );
  const blob = (await call(
    api.GET("/api/v1/exports/{export_id}/download", {
      params: { path: { export_id: created.id } },
      parseAs: "blob",
    }),
  )) as Blob;
  const name = `${fileName.replace(/\.[^.]+$/, "") || "result"}.xlsx`;

  if (liff.isInClient()) {
    const bytes = await blob.arrayBuffer();
    return { how: "prepared", file: new File([bytes], name, { type: XLSX_TYPE }), exportId: created.id };
  }

  // Elsewhere: fetched through the api client (tenant header), saved via an object URL.
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { how: "saved" };
}

/** Whether this browser can hand the file to the system share sheet (iOS LINE often cannot). */
export function canShareFile(file: File): boolean {
  try {
    return typeof navigator.share === "function" && typeof navigator.canShare === "function" &&
      navigator.canShare({ files: [file] });
  } catch {
    return false;
  }
}

/** Only when the user asks for it: the phone browser has no session, so a 60-second ticket
 *  stands in for it (LINE asks before opening the external app). */
export async function openExportInBrowser(exportId: string, liff: Liff): Promise<void> {
  const ticket = await call(
    api.POST("/api/v1/exports/{export_id}/ticket", { params: { path: { export_id: exportId } } }),
  );
  liff.openWindow({ url: new URL(ticket.url, apiBaseUrl || window.location.origin).href, external: true });
}
