// Ported from apps/line-mini/src/services/errors.ts (web-pc-account plan: copied, not shared).
import { isMessageKey, type T } from "../i18n";

/** A failed backend call: the backend's error code, or "network" when it was unreachable. */
export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    public fields: string[],
    public details?: Record<string, unknown>,
  ) {
    super(code);
    this.name = "ApiError";
  }
}

/** The localized message for an error (FR-SYS-055): err.<code>, else the generic one. */
export function errorMessage(error: unknown, t: T): string {
  if (error instanceof ApiError) {
    const key = `err.${error.code}`;
    if (isMessageKey(key)) return t(key);
  }
  return t("err.unknown");
}

/** Whether the error names this form field. */
export function hasField(error: unknown, field: string): boolean {
  return error instanceof ApiError && error.fields.includes(field);
}
