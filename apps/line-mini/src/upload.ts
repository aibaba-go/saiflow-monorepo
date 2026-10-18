import { completeUpload, createUpload, uploadContent, type FileInfo } from './api';

export async function uploadFile(
  file: File,
  workspace?: { workspace_type?: string; enterprise_id?: number },
  purpose: 'OCR_TASK' | 'APPLICATION_MATERIAL' = 'OCR_TASK',
  onProgress?: (percent: number) => void,
): Promise<FileInfo> {
  let percent = 0;
  const report = (next: number) => {
    percent = Math.max(percent, next);
    onProgress?.(percent);
  };
  const started = performance.now();
  const estimatedMs = 3000 + (file.size / (512 * 1024)) * 1000;
  // 预检、存储与校验没有字节事件，估算期间保留最后 5% 给后端确认。
  const timer = onProgress ? window.setInterval(() => {
    report(Math.min(95, Math.floor(95 * (1 - Math.exp(-(performance.now() - started) / estimatedMs)))));
  }, 120) : undefined;
  report(0);
  try {
    const { upload_id: uploadId } = await createUpload(file.name, file.size, workspace, purpose);
    await uploadContent(uploadId, file, file.type || 'application/octet-stream',
      onProgress ? (fraction) => report(Math.min(95, Math.floor(fraction * 95))) : undefined);
    const { file: ready } = await completeUpload(uploadId);
    report(100);
    return ready;
  } finally {
    if (timer !== undefined) window.clearInterval(timer);
  }
}

export function newIdempotencyKey(): string {
  return crypto.randomUUID();
}
