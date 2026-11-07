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
  extra?: ReactNode;
}

/** A labelled input with its own error line underneath. */
export function Field({ id, label, value, onChange, error, field, type = "text", extra }: FieldProps) {
  const t = useT();
  return (
    <div className="field">
      <label htmlFor={id} className="field__label">
        {label}
      </label>
      <div className="field__row">
        <Input id={id} type={type} value={value} onChange={onChange} clearable clearLabel={t("common.clear")} />
        {extra}
      </div>
      <FieldError error={error} field={field} />
    </div>
  );
}
