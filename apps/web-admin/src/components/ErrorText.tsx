import { Alert } from "antd";

import { useT } from "../i18n";
import { errorMessage } from "../services/errors";

/** A form- or page-level error message; nothing when there is no error. */
export function ErrorText({ error }: { error: unknown }) {
  const t = useT();
  if (!error) return null;
  return <Alert role="alert" type="error" showIcon message={errorMessage(error, t)} />;
}
