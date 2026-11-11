import type { components } from "@saiflow/api-client";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { App, Button, Input, Space, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { Link } from "react-router-dom";

import { ConfirmButton } from "../components/ConfirmButton";
import { ErrorText } from "../components/ErrorText";
import { Page } from "../components/Page";
import { formatTime } from "../format";
import { useT } from "../i18n";
import { api, call } from "../services/api";
import { errorMessage } from "../services/errors";

type AdminUser = components["schemas"]["AdminUserOut"];

/** What the backend accepts as a search (FR-SYS-080): empty for every user, 2+ characters,
 * or a user id. */
export function searchable(text: string): boolean {
  const q = text.trim();
  return q === "" || q.length >= 2 || /^\d+$/.test(q);
}

/** Every customer user, newest first and page by page, narrowed by a search, with a way into
 * the personal tenant (FR-SYS-070) and a way to enter web-pc as a registered user (FR-SYS-146). */
export function UsersPage() {
  const t = useT();
  const { message, modal } = App.useApp();
  const [text, setText] = useState("");
  const [search, setSearch] = useState<{ q: string; page: number }>({ q: "", page: 1 });
  const [tooShort, setTooShort] = useState(false);
  const result = useQuery({
    queryKey: ["users", search],
    queryFn: () =>
      call(
        api.GET("/api/v1/admin/users", {
          params: { query: { ...(search.q ? { q: search.q } : {}), page: String(search.page) } },
        }),
      ),
    placeholderData: keepPreviousData,
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
    {
      title: t("col.actions"),
      key: "actions",
      render: (_, u) =>
        u.registered ? (
          <ConfirmButton
            label={t("users.impersonate")}
            title={t("users.impersonateTitle", { name: u.display_name ?? `#${u.user_id}` })}
            description={<div style={{ maxWidth: 320 }}>{t("users.impersonateBody")}</div>}
            onConfirm={() => impersonate(u.user_id)}
          />
        ) : null,
    },
  ];

  /** FR-SYS-146: issue a one-time link and open web-pc as the user in a new tab. The tab is
   * opened before the request so the click still counts as a user gesture. */
  async function impersonate(userId: number) {
    const tab = window.open("", "_blank");
    try {
      const link = await call(
        api.POST("/api/v1/admin/users/{user_id}/impersonation", { params: { path: { user_id: userId } } }),
      );
      if (tab) {
        tab.opener = null;
        tab.location.href = link.url;
      } else {
        modal.info({
          title: t("users.impersonate"),
          content: (
            <div>
              <Typography.Paragraph>{t("users.impersonateBlocked")}</Typography.Paragraph>
              <a href={link.url} target="_blank" rel="noopener noreferrer">
                {t("users.impersonateOpen")}
              </a>
            </div>
          ),
        });
      }
    } catch (e) {
      tab?.close();
      void message.error(errorMessage(e, t));
    }
  }

  return (
    <Page name="users" title={t("nav.users")}>
      <div className="ad-panel">
        <div className="ad-panel__toolbar">
          <Input.Search
            placeholder={t("users.placeholder")}
            enterButton={t("users.search")}
            allowClear
            value={text}
            maxLength={200}
            onChange={(e) => setText(e.target.value)}
            onSearch={submit}
            style={{ maxWidth: 420 }}
          />
          {tooShort && <Typography.Text type="warning">{t("users.tooShort")}</Typography.Text>}
          <ErrorText error={result.error} />
        </div>
        <Table<AdminUser>
          rowKey="user_id"
          loading={result.isFetching}
          dataSource={result.data?.items ?? []}
          columns={columns}
          pagination={false}
          scroll={{ x: true }}
        />
        <div className="ad-panel__footer">
          <Space>
            <Button disabled={search.page <= 1} onClick={() => setSearch({ ...search, page: search.page - 1 })}>
              {t("common.prev")}
            </Button>
            <Typography.Text type="secondary">{t("users.page", { n: search.page })}</Typography.Text>
            <Button
              disabled={!result.data?.has_more || result.isPlaceholderData}
              onClick={() => setSearch({ ...search, page: search.page + 1 })}
            >
              {t("common.next")}
            </Button>
          </Space>
        </div>
      </div>
    </Page>
  );
}
