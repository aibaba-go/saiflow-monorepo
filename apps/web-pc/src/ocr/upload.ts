// Ported from apps/line-mini/src/features/scan/upload.ts (web-pc-ocr: copied, not shared).
import type { components } from "@saiflow/api-client";

import { api, call } from "../services/api";
import { ApiError } from "../services/errors";

export type FileOut = components["schemas"]["FileOut"];

/** FR-SYS-057 and A1: up to 10 files a selection, JPG/PNG/PDF, at most 20 MB each. */
export const MAX_FILES = 10;
export const MAX_BYTES = 20 * 1024 * 1024;
const TYPES = new Set(["image/jpeg", "image/jpg", "image/png", "application/pdf"]);

/** A rejection known before any upload, as the backend's code; the backend still sniffs. */
export function localCheck(file: File): "unsupported_format" | "file_too_large" | null {
  const mime = (file.type || "").toLowerCase();
  const typed = mime && mime !== "application/octet-stream";
  if (typed ? !TYPES.has(mime) : !/\.(jpe?g|png|pdf)$/i.test(file.name)) return "unsupported_format";
  if (file.size > MAX_BYTES) return "file_too_large";
  return null;
}

/** Create the upload, send the bytes, complete it (FR-UPLOAD-003). Any failure deletes the
 * half-created upload, best effort, so a failed file never stays in Pending (main
 * ScanHomePage). onProgress gets 0–100 per step: there are no byte events with fetch. */
export async function uploadFile(
  file: File,
  onProgress: (percent: number) => void,
  { signal }: { signal?: AbortSignal } = {},
): Promise<FileOut> {
  const local = localCheck(file);
  if (local) throw new ApiError(400, local, ["file"]);
  onProgress(5);
  const created = await call(api.POST("/api/v1/uploads", { body: { file_name: file.name }, signal }));
  try {
    if (signal?.aborted) throw new ApiError(0, "cancelled", []);
    onProgress(15);
    const bytes = new Uint8Array(await file.arrayBuffer());
    await call(
      api.PUT("/api/v1/uploads/{upload_id}/content", {
        params: { path: { upload_id: created.id } },
        body: bytes as never,
        bodySerializer: (b: unknown) => b as BodyInit,
        headers: { "Content-Type": file.type || "application/octet-stream" },
        signal,
      }),
    );
    if (signal?.aborted) throw new ApiError(0, "cancelled", []);
    onProgress(85);
    const ready = await call(
      api.POST("/api/v1/uploads/{upload_id}/complete", {
        params: { path: { upload_id: created.id } },
        signal,
      }),
    );
    onProgress(100);
    return ready;
  } catch (error) {
    // Failed or cancelled: the half-made upload goes, so it never shows in Pending.
    void call(api.DELETE("/api/v1/files/{file_id}", { params: { path: { file_id: created.id } } })).catch(
      () => undefined,
    );
    throw error;
  }
}

export async function deletePending(fileId: string): Promise<void> {
  await call(api.DELETE("/api/v1/files/{file_id}", { params: { path: { file_id: fileId } } }));
}
