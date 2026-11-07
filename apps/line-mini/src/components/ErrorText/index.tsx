import { useT } from "../../i18n";
import { errorMessage } from "../../services/errors";

export interface ErrorTextProps {
  error: unknown;
}

/** A localized error line, or nothing when there is no error. */
export function ErrorText({ error }: ErrorTextProps) {
  const t = useT();
  if (!error) return null;
  return (
    <div role="alert" style={{ color: "var(--danger-text)", fontSize: 13, marginTop: 4 }}>
      {errorMessage(error, t)}
    </div>
  );
}
