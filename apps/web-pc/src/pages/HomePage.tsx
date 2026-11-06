import { Space } from "antd";
import { Link } from "react-router-dom";

import { UsageCard } from "../billing/UsageCard";
import { Page } from "../components/Page";
import { useT } from "../i18n";

/** Home: the current tenant's usage and the way to the plans (FR-SYS-094). */
export function HomePage() {
  const t = useT();
  return (
    <Page name="home" title={t("nav.home")}>
      <Space direction="vertical" size="large">
        <UsageCard />
        <Link to="/plans">{t("my.plans")}</Link>
      </Space>
    </Page>
  );
}
