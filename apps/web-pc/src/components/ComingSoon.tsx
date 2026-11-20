import { Result } from "antd";

import { useT } from "../i18n";

export function ComingSoon() {
  const t = useT();
  return <Result status="info" title={t("common.comingSoon")} subTitle={t("common.comingSoonBody")} />;
}
