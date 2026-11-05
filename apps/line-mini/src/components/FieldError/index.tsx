import { isMessageKey, useT } from "../../i18n";
import { ApiError, errorMessage } from "../../services/errors";

export interface FieldErrorProps {
  error: unknown;
  field: string;
}

/** The error for one form field (FR-SYS-055-02): a plain validation error says what the
 * field needs (field.<name>); any other error that names the field shows its own message. */
export function FieldError({ error, field }: FieldErrorProps) {
  const t = useT();
  if (!(error instanceof ApiError) || !error.fields.includes(field)) return null;
  const key = `field.${field}`;
  const text =
    error.code === "validation_error" && isMessageKey(key) ? t(key) : errorMessage(error, t);
  return (
    <div role="alert" className="field-error">
      {text}
    </div>
  );
}

/** An error that belongs to no field, for the form's own message line. */
export function formLevel(error: unknown): unknown {
  return error instanceof ApiError && error.fields.length > 0 ? null : error;
}
