import { completeUpload, createUpload, uploadContent, UploadCancelledError, type FileInfo, type TenantRef } from './api';

export interface UploadFileOptions {
  /** FR-UPLOAD-013：用户取消；中止当前 XHR，不再进入后续阶段，也不报告 100%。 */
  signal?: AbortSignal;
  /** 上传会话（即文件 id）创建后回调，供取消时删除该会话。 */
  onSession?: (uploadId: string) => void;
}

export async function uploadFile(
  file: File,
  tenantId?: TenantRef,
  purpose: 'OCR_TASK' | 'APPLICATION_MATERIAL' = 'OCR_TASK',
  onProgress?: (percent: number) => void,
  options: UploadFileOptions = {},
): Promise<FileInfo> {
  const { signal, onSession } = options;
  let percent = 0;
  const report = (next: number) => {
    if (signal?.aborted) return;
    percent = Math.max(percent, next);
    onProgress?.(percent);
  };
  const started = performance.now();
  const estimatedMs = 3000 + (file.size / (512 * 1024)) * 1000;
  // 预检、存储与校验没有字节事件，估算期间保留最后 5% 给后端确认。
  let timer = onProgress ? window.setInterval(() => {
    report(Math.min(95, Math.floor(95 * (1 - Math.exp(-(performance.now() - started) / estimatedMs)))));
  }, 120) : undefined;
  const stopTimer = () => {
    if (timer !== undefined) window.clearInterval(timer);
    timer = undefined;
  };
  const ensureActive = () => {
    if (signal?.aborted) throw new UploadCancelledError();
  };
  signal?.addEventListener('abort', stopTimer, { once: true });
  try {
    ensureActive();
    report(0);
    const { upload_id: uploadId } = await createUpload(file.name, file.size, tenantId, purpose, signal);
    onSession?.(uploadId);
    ensureActive();
    await uploadContent(uploadId, file, file.type || 'application/octet-stream',
      onProgress ? (fraction) => report(Math.min(95, Math.floor(fraction * 95))) : undefined, signal);
    ensureActive();
    const { file: ready } = await completeUpload(uploadId, signal);
    ensureActive();
    report(100);
    return ready;
  } finally {
    stopTimer();
    signal?.removeEventListener('abort', stopTimer);
  }
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
