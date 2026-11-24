import { DataSourceManager } from "@saiflow/ui/data-sources";
import { Page } from "../components/Page";
import { useT } from "../i18n";
import { ReportGate } from "../reports/common";
import { dataSources } from "../reports/dataSources";
import { useLanguage } from "../stores/language";
import { can } from "../tenants/permissions";
import { useTenant } from "../tenants/useTenant";

export function DataSourcesPage() {
  const t = useT();
  const { tenant } = useTenant();
  const lang = useLanguage(s => s.lang);
  return <ReportGate need="manage"><Page name="data-sources" title={t("nav.dataSources")}>
    <section className="pc-panel"><DataSourceManager key={tenant?.tenant_id} api={dataSources} lang={lang} canQuery={can(tenant, "data_browse")} showSystemNotice /></section>
  </Page></ReportGate>;
}
