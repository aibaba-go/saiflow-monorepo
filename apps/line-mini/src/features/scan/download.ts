import { api, call } from "../../services/api";
import { deliverDownload } from "../../services/download";
import { serverAttachmentBranch } from "../../services/liffDiagnostics";
import type { Liff } from "../../services/liffTypes";
import type { Lang } from "../../stores/language";

/** Server attachment delivery as in the working 20261104 version (FR-SYS-107,
 * FR-ENTRY-015): iOS LINE follows a real HTTP link, Android opens the phone browser.
 * Fresh tickets preserve the current tenant/session without downloader headers. */
export type XlsxOutcome = { how: "saved" | "external" };

export async function exportAndDownload(
  jobId: string,
  language: Lang,
  liff: Liff,
  fileName: string,
  signal?: AbortSignal,
): Promise<XlsxOutcome> {
  const created = await call(
    api.POST("/api/v1/ocr/jobs/{job_id}/exports", {
      signal,
      params: { path: { job_id: jobId } },
      body: { language },
    }),
  );
  signal?.throwIfAborted();
  if (serverAttachmentBranch(liff, "xlsx")) {
    const ticket = await call(api.POST("/api/v1/exports/{export_id}/ticket", {
      signal,
      params: { path: { export_id: created.id } },
    }));
    signal?.throwIfAborted();
    return { how: deliverDownload(liff, ticket.url, "/api/v1/export-downloads/") };
  }

  const blob = (await call(
    api.GET("/api/v1/exports/{export_id}/download", {
      signal,
      params: { path: { export_id: created.id } },
      parseAs: "blob",
    }),
  )) as Blob;
  signal?.throwIfAborted();
  const name = `${fileName.replace(/\.[^.]+$/, "") || "result"}.xlsx`;
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
  return { how: "saved" };
}
