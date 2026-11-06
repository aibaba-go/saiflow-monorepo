import { fieldErrorText } from "../components/FieldError";
import type { T } from "../i18n";

/** Form.Item props for one field: the error under its input (FR-SYS-104-03). */
export function fieldProps(error: unknown, t: T) {
  return (field: string) => {
    const text = fieldErrorText(error, field, t);
    return { validateStatus: text ? ("error" as const) : undefined, help: text };
  };
}
