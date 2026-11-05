import { ErrorBlock } from "antd-mobile";

import { useT } from "../../i18n";

/** Placeholder until scanning, history and reports exist (FR-SYS-056). */
export function ComingSoon() {
  const t = useT();
  return (
    <ErrorBlock
      status="empty"
      title={t("common.comingSoon")}
      description={t("common.comingSoonBody")}
    />
  );
}
