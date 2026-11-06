// Ported from apps/web-admin/src/components/FieldError.tsx (web-pc-account plan: copied, not shared).
import { isMessageKey, useT } from "../i18n";
import { ApiError, errorMessage } from "../services/errors";

/** The error for one form field: a plain validation error says what the field needs
 * (field.<name>); any other error that names the field shows its own message. */
export function fieldErrorText(error: unknown, field: string, t: ReturnType<typeof useT>) {
  if (!(error instanceof ApiError) || !error.fields.includes(field)) return undefined;
  const key = `field.${field}`;
  if (error.code === "required") return t("field.required");
  if (error.code === "validation_error" && isMessageKey(key)) return t(key);
  return errorMessage(error, t);
}

export function FieldError({ error, field }: { error: unknown; field: string }) {
  const t = useT();
  const text = fieldErrorText(error, field, t);
  if (!text) return null;
  return (
    <div role="alert" style={{ color: "#ff4d4f" }}>
      {text}
    </div>
  );
}

/** An error that belongs to no field, for the form's own message line. */
export function formLevel(error: unknown): unknown {
  return error instanceof ApiError && error.fields.length > 0 ? null : error;
}

/** A client-side "required" error for the empty fields, or null when all are filled. */
export function requireFields(values: Record<string, string>): ApiError | null {
  const missing = Object.entries(values)
    .filter(([, v]) => !v.trim())
    .map(([k]) => k);
  return missing.length ? new ApiError(400, "required", missing) : null;
}
