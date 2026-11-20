// Ported from apps/line-mini/src/features/scan/uploadQueue.ts (web-pc-ocr: copied, not shared).
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiError } from "../services/errors";
import { deletePending, localCheck, uploadFile } from "./upload";

/** main ScanHomePage's upload batch (FR-SYS-110): one file at a time, each with its own
 * AbortController; cancel one or all, retry the failed ones that can be retried. */
export type UploadStatus = "waiting" | "uploading" | "uploaded" | "failed" | "cancelled";

export interface UploadItem {
  key: number;
  name: string;
  size: number;
  format: string;
  image: boolean;
  status: UploadStatus;
  percent: number;
  error: unknown;
  /** A local type or size rejection would fail again, so it is not retried. */
  retryable: boolean;
}

let nextKey = 0;

export function formatOf(file: File): string {
  const ext = /\.([a-z0-9]+)$/i.exec(file.name)?.[1]?.toUpperCase();
  if (ext) return ext === "JPEG" ? "JPG" : ext;
  return file.type.split("/")[1]?.toUpperCase() || "—";
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function useUploadQueue(onUploaded: () => void) {
  const list = useRef<UploadItem[]>([]);
  const sources = useRef(new Map<number, File>());
  const current = useRef<{ key: number; controller: AbortController } | null>(null);
  const running = useRef(false);
  const [items, setItems] = useState<UploadItem[]>([]);
  const [busy, setBusy] = useState(false);
  const [cancelled, setCancelled] = useState(0);
  const [cancelAllUsed, setCancelAllUsed] = useState(false);
  const uploaded = useRef(onUploaded);
  useEffect(() => {
    uploaded.current = onUploaded;
  }, [onUploaded]);
  // Leaving the page (or a tenant switch, which remounts it) stops the running upload.
  useEffect(() => () => current.current?.controller.abort(), []);

  const commit = useCallback((next: UploadItem[]) => {
    list.current = next;
    setItems(next);
  }, []);
  const patch = useCallback(
    (key: number, change: Partial<UploadItem>) =>
      commit(list.current.map((i) => (i.key === key ? { ...i, ...change } : i))),
    [commit],
  );
  const alive = (key: number) => list.current.some((i) => i.key === key && i.status !== "cancelled");

  const run = useCallback(async () => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    try {
      for (;;) {
        const item = list.current.find((i) => i.status === "waiting");
        const source = item ? sources.current.get(item.key) : undefined;
        if (!item || !source) break;
        const key = item.key;
        patch(key, { status: "uploading", percent: 0, error: null });
        const controller = new AbortController();
        current.current = { key, controller };
        try {
          const ready = await uploadFile(
            source,
            (percent) => {
              const now = list.current.find((i) => i.key === key);
              if (!controller.signal.aborted && now) patch(key, { percent: Math.max(now.percent, percent) });
            },
            { signal: controller.signal },
          );
          current.current = null;
          if (!alive(key)) {
            // cancelled while the last step finished: the file must not stay in Pending
            void deletePending(ready.id).catch(() => undefined);
            continue;
          }
          patch(key, { status: "uploaded", percent: 100 });
          uploaded.current();
        } catch (error) {
          current.current = null;
          if (!alive(key)) continue;
          patch(key, { status: "failed", error });
          if (error instanceof ApiError && error.status === 401) {
            commit(list.current.map((i) => (i.status === "waiting" ? { ...i, status: "failed", error } : i)));
            break;
          }
        }
      }
    } finally {
      running.current = false;
      current.current = null;
      setBusy(false);
    }
  }, [commit, patch]);

  const start = useCallback(
    (files: File[]) => {
      if (!files.length) return;
      // a drop while uploading joins the running batch (minor-fixes-ui); otherwise a new batch
      const fresh = !running.current;
      if (fresh) {
        sources.current.clear();
        setCancelled(0);
        setCancelAllUsed(false);
      }
      const added: UploadItem[] = files.map((file) => {
          const key = ++nextKey;
          sources.current.set(key, file);
          const local = localCheck(file);
          return {
            key,
            name: file.name,
            size: file.size,
            format: formatOf(file),
            image: file.type ? file.type.startsWith("image/") : /\.(jpe?g|png)$/i.test(file.name),
            status: local ? "failed" : "waiting",
            percent: 0,
            error: local ? new ApiError(400, local, ["file"]) : null,
            retryable: !local,
          };
        });
      commit(fresh ? added : [...list.current, ...added]);
      void run();
    },
    [commit, run],
  );

  const remove = useCallback(
    (keys: number[]) => {
      // the row stays, marked cancelled (FR-SYS-127); its file is not retried
      commit(list.current.map((i) => (keys.includes(i.key) ? { ...i, status: "cancelled", retryable: false } : i)));
      for (const key of keys) sources.current.delete(key);
      if (current.current && keys.includes(current.current.key)) current.current.controller.abort();
      setCancelled((n) => n + keys.length);
    },
    [commit],
  );

  /** One file: waiting or uploading leaves the batch (the running request is aborted and
   * its half-made upload deleted by uploadFile); a failed row just disappears. */
  const cancel = useCallback((key: number) => remove([key]), [remove]);

  const cancelAll = useCallback(() => {
    const keys = list.current
      .filter((i) => i.status === "waiting" || i.status === "uploading")
      .map((i) => i.key);
    if (!keys.length) return;
    setCancelAllUsed(true);
    remove(keys);
  }, [remove]);

  const retryable = (i: UploadItem) => i.status === "failed" && i.retryable && sources.current.has(i.key);

  const retry = useCallback(
    (keys: number[]) => {
      if (!list.current.some((i) => keys.includes(i.key) && retryable(i))) return;
      commit(
        list.current.map((i) =>
          keys.includes(i.key) && retryable(i) ? { ...i, status: "waiting", percent: 0, error: null } : i,
        ),
      );
      setCancelled(0);
      setCancelAllUsed(false);
      void run();
    },
    [commit, run],
  );

  /** Drop the ended rows: uploaded, failed and cancelled. */
  const clearFinished = useCallback(() => {
    const ended = list.current.filter((i) => ["uploaded", "failed", "cancelled"].includes(i.status));
    for (const i of ended) sources.current.delete(i.key);
    commit(list.current.filter((i) => !ended.includes(i)));
  }, [commit]);

  const retryFailed = useCallback(
    () => retry(list.current.filter((i) => i.status === "failed").map((i) => i.key)),
    [retry],
  );

  return {
    items,
    busy,
    cancelled,
    cancelAllUsed,
    start,
    cancel,
    cancelAll,
    retry: (key: number) => retry([key]),
    retryFailed,
    clearFinished,
    canRetry: (item: UploadItem) => item.status === "failed" && item.retryable,
  };
}
