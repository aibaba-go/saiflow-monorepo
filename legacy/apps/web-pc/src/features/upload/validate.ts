import { ALLOWED_EXTENSIONS, MAX_FILE_SIZE_BYTES } from '../../mock/defaults';

/** 上传前校验（FR-UPLOAD-002/003/004）：仅 JPG/PNG/PDF、单文件 ≤ 20 MB。 */
export function validateUploadFile(file: { name: string; size: number }):
  | { ok: true }
  | { ok: false; reason: 'unsupported_file_type' | 'file_too_large' } {
  const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
  if (!ALLOWED_EXTENSIONS.includes(ext as (typeof ALLOWED_EXTENSIONS)[number])) {
    return { ok: false, reason: 'unsupported_file_type' };
  }
  if (file.size > MAX_FILE_SIZE_BYTES) {
    return { ok: false, reason: 'file_too_large' };
  }
  return { ok: true };
}
