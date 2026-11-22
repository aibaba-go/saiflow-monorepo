import { DataSourceManager } from "@saiflow/ui/data-sources";
import { useQuery } from "@tanstack/react-query";
import { Alert, Select, Space } from "antd";
import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import { ErrorText } from "../components/ErrorText";
import { Page } from "../components/Page";
import { useT } from "../i18n";
import { adminDataSources } from "../services/dataSources";
import { idParam, organizations, orgKeys } from "../services/organizations";
import { useLanguage } from "../stores/language";

export function DataSourcesPage() {
  const t = useT(); const lang = useLanguage(s => s.lang);
  const [params, setParams] = useSearchParams();
  const tenantId = idParam(params.get("tenant") ?? undefined);
  const list = useQuery({ queryKey: orgKeys.all, queryFn: organizations.list });
  const api = useMemo(() => adminDataSources(tenantId), [tenantId]);
  return <Page name="dataSources" title={t("nav.dataSources")}>
    <Space direction="vertical" size="middle" style={{ width: "100%" }}>
      <Select aria-label={t("rpa.org")} showSearch allowClear loading={list.isPending} value={tenantId ?? undefined} placeholder={t("rpa.orgPlaceholder")} optionFilterProp="label" style={{ minWidth: 280 }} options={(list.data ?? []).map(o => ({ value: o.tenant_id, label: o.name }))} onChange={(id: number | undefined) => setParams(id ? { tenant: String(id) } : {}, { replace: true })} />
      <ErrorText error={list.error} />
      <Alert type="info" showIcon message={t("dataSources.ownership")} />
      <div className="ad-panel"><DataSourceManager key={tenantId ?? "system"} api={api} lang={lang} allowCreate={!!tenantId} /></div>
    </Space>
  </Page>;
}
