import type { components } from "@saiflow/api-client";
import { useQuery } from "@tanstack/react-query";
import { Button, Input, Space, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { Link } from "react-router-dom";

import { ErrorText } from "../components/ErrorText";
import { Page } from "../components/Page";
import { formatTime } from "../format";
import { useT } from "../i18n";
import { api, call } from "../services/api";

type AdminUser = components["schemas"]["AdminUserOut"];

/** What the backend accepts as a search (FR-SYS-080): 2+ characters, or a user id. */
export function searchable(text: string): boolean {
  const q = text.trim();
  return q.length >= 2 || /^\d+$/.test(q);
}

/** Customer user search, with a way into the personal tenant (FR-SYS-070). */
export function UsersPage() {
  const t = useT();
  const [text, setText] = useState("");
  const [search, setSearch] = useState<{ q: string; page: number } | null>(null);
  const [tooShort, setTooShort] = useState(false);
  const result = useQuery({
    queryKey: ["users", search],
    queryFn: () =>
      call(api.GET("/api/v1/admin/users", { params: { query: { q: search!.q, page: String(search!.page) } } })),
    enabled: search !== null,
  });

  function submit(value: string) {
    if (!searchable(value)) {
      setTooShort(true);
      return;
    }
    setTooShort(false);
    setSearch({ q: value.trim(), page: 1 });
  }

  const columns: ColumnsType<AdminUser> = [
    { title: t("col.userId"), dataIndex: "user_id" },
    { title: t("col.nickname"), key: "name", render: (_, u) => u.display_name ?? "—" },
    { title: t("col.email"), key: "email", render: (_, u) => u.email ?? "—" },
    { title: t("col.mobile"), key: "phone", render: (_, u) => u.phone ?? "—" },
    { title: t("col.registered"), key: "registered", render: (_, u) => t(u.registered ? "common.yes" : "common.no") },
    {
      title: t("col.personalTenant"),
      key: "tenant",
      render: (_, u) =>
        u.personal_tenant_id ? (
          <Link to={`/tenants/${u.personal_tenant_id}/billing?kind=personal`}>
            {t("tenant.ref", { id: u.personal_tenant_id })}
          </Link>
        ) : (
          "—"
        ),
    },
    { title: t("col.registeredAt"), key: "registered_at", render: (_, u) => formatTime(u.registered_at) },
  ];

  return (
    <Page title={t("nav.users")}>
      <Space direction="vertical" style={{ width: "100%" }}>
        <Input.Search
          placeholder={t("users.placeholder")}
          enterButton={t("users.search")}
          value={text}
          maxLength={200}
          onChange={(e) => setText(e.target.value)}
          onSearch={submit}
          style={{ maxWidth: 420 }}
        />
        {tooShort && <Typography.Text type="warning">{t("users.tooShort")}</Typography.Text>}
        <ErrorText error={result.error} />
        {search && (
          <>
            <Table<AdminUser>
              rowKey="user_id"
              loading={result.isFetching}
              dataSource={result.data?.items ?? []}
              columns={columns}
              pagination={false}
              scroll={{ x: true }}
            />
            <Space>
              <Button disabled={search.page <= 1} onClick={() => setSearch({ ...search, page: search.page - 1 })}>
                {t("common.prev")}
              </Button>
              <Button disabled={!result.data?.has_more} onClick={() => setSearch({ ...search, page: search.page + 1 })}>
                {t("common.next")}
              </Button>
            </Space>
          </>
        )}
      </Space>
    </Page>
  );
}
