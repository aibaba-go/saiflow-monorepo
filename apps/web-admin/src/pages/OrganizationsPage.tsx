import { useQuery } from "@tanstack/react-query";
import { Input, Table } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { ErrorText } from "../components/ErrorText";
import { Page } from "../components/Page";
import { OrgStatusTag, VerificationTag } from "../components/Tags";
import { formatTime } from "../format";
import { useT } from "../i18n";
import { orgKeys, organizations, type Organization } from "../services/organizations";

/** Organization list with a name search (FR-SYS-064-01). The admin API returns every
 * organization; filtering in the browser is enough at the current scale. */
export function OrganizationsPage() {
  const t = useT();
  const [query, setQuery] = useState("");
  const list = useQuery({ queryKey: orgKeys.all, queryFn: organizations.list });
  const shown = useMemo(() => {
    const q = query.trim().toLocaleLowerCase();
    return (list.data ?? []).filter((o) => !q || o.name.toLocaleLowerCase().includes(q));
  }, [list.data, query]);

  const columns: ColumnsType<Organization> = [
    { title: t("col.name"), key: "name", render: (_, o) => <Link to={`/organizations/${o.tenant_id}`}>{o.name}</Link> },
    { title: t("col.status"), key: "status", render: (_, o) => <OrgStatusTag status={o.status} /> },
    { title: t("col.verification"), key: "verification", render: (_, o) => <VerificationTag status={o.verification_status} /> },
    { title: t("col.members"), dataIndex: "member_count" },
    { title: t("col.foundedAt"), key: "created", render: (_, o) => formatTime(o.created_at) },
  ];

  return (
    <Page name="organizations" title={t("nav.organizations")}>
      <div className="ad-panel">
        <div className="ad-panel__toolbar">
          <Input.Search
            allowClear
            placeholder={t("org.search")}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            style={{ maxWidth: 360 }}
          />
          <ErrorText error={list.error} />
        </div>
        <Table<Organization>
          rowKey="tenant_id"
          loading={list.isPending}
          dataSource={shown}
          columns={columns}
          scroll={{ x: true }}
          pagination={{ pageSize: 50, hideOnSinglePage: true }}
        />
      </div>
    </Page>
  );
}
