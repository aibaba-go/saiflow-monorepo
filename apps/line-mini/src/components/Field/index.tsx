import type { ReactNode } from "react";

import { useT } from "../../i18n";
import { FieldError } from "../FieldError";
import { Input } from "../ui/input";

export interface FieldProps {
  id: string;
  label: string;
  value: string;
  onChange(value: string): void;
  error?: unknown;
  /** The backend field name the error may point at. */
  field: string;
  type?: string;
  /** Browser autofill hint, e.g. "email" or "tel" (the phone keyboard offers the saved value). */
  autoComplete?: string;
  inputMode?: "text" | "email" | "tel" | "numeric";
  extra?: ReactNode;
}

/** A labelled input with its own error line underneath. */
export function Field({ id, label, value, onChange, error, field, type = "text", autoComplete, inputMode, extra }: FieldProps) {
  const t = useT();
  return (
    <div className="field">
      <label htmlFor={id} className="field__label">
        {label}
      </label>
      <div className="field__row">
        <Input
          id={id}
          type={type}
          autoComplete={autoComplete}
          inputMode={inputMode}
          value={value}
          onChange={onChange}
          clearable
          clearLabel={t("common.clear")}
        />
        {extra}
      </div>
      <FieldError error={error} field={field} />
    </div>
  );
}
