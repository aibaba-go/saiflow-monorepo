import type { components } from "@saiflow/api-client";
import { keepPreviousData, useQuery, useQueryClient } from "@tanstack/react-query";
import { Alert, App, Button, Form, Input, Modal, Space, Table, Typography } from "antd";
import type { ColumnsType } from "antd/es/table";
import { useState } from "react";
import { Link } from "react-router-dom";

import { ConfirmButton } from "../components/ConfirmButton";
import { ErrorText } from "../components/ErrorText";
import { Page } from "../components/Page";
import { fieldErrorText, formLevel } from "../components/FieldError";
import { useSubmit } from "../hooks/useSubmit";
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
  const [createOpen, setCreateOpen] = useState(false);
  const queryClient = useQueryClient();
  async function remove(userId: number) {
    try {
      await call(api.DELETE("/api/v1/admin/users/{user_id}", { params: { path: { user_id: userId } } }));
      void message.success(t("users.deleted"));
      await queryClient.invalidateQueries({ queryKey: ["users"] });
    } catch (error) {
      void message.error(errorMessage(error, t));
    }
  }
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
    { title: t("users.lineLinked"), key: "line", render: (_, u) => t(u.line_linked ? "common.yes" : "common.no") },
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
      render: (_, u) => (
        <Space wrap>
          {u.registered && <ConfirmButton
            label={t("users.impersonate")}
            title={t("users.impersonateTitle", { name: u.display_name ?? `#${u.user_id}` })}
            description={<div style={{ maxWidth: 320 }}>{t("users.impersonateBody")}</div>}
            onConfirm={() => impersonate(u.user_id)}
          />}
          <ConfirmButton danger label={t("users.delete")}
            title={t("users.deleteTitle", { name: u.email ?? u.display_name ?? `#${u.user_id}` })}
            description={<div style={{ maxWidth: 340 }}>{t("users.deleteBody")}</div>}
            onConfirm={() => remove(u.user_id)} />
        </Space>
      ),
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
          <Button type="primary" onClick={() => setCreateOpen(true)}>{t("users.create")}</Button>
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
      <Modal open={createOpen} title={t("users.create")} footer={null} destroyOnHidden onCancel={() => setCreateOpen(false)}>
        {createOpen && <CreateUser onDone={async () => {
          setCreateOpen(false);
          setText("");
          setSearch({ q: "", page: 1 });
          await queryClient.invalidateQueries({ queryKey: ["users"] });
        }} />}
      </Modal>
    </Page>
  );
}

function CreateUser({ onDone }: { onDone(): Promise<void> }) {
  const t = useT();
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const props = (field: string) => {
    const help = fieldErrorText(error, field, t);
    return { help, validateStatus: help ? "error" as const : undefined };
  };
  const submit = useSubmit(async () => {
    setError(null);
    try {
      await call(api.POST("/api/v1/admin/users", { body: { email, display_name: name, phone: phone.trim() || null, password } }));
      await onDone();
    } catch (e) { setError(e); }
  });
  return <Form layout="vertical" requiredMark={false} noValidate onFinish={() => void submit.run()}>
    <Alert type="info" showIcon message={t("users.createHint")} style={{ marginBottom: 20 }} />
    <Form.Item label={t("col.email")} htmlFor="create-email" {...props("email")}>
      <Input id="create-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="off" />
    </Form.Item>
    <Form.Item label={t("col.nickname")} htmlFor="create-name" {...props("display_name")}>
      <Input id="create-name" maxLength={128} value={name} onChange={(e) => setName(e.target.value)} />
    </Form.Item>
    <Form.Item label={t("users.initialPassword")} htmlFor="create-password" {...props("password")} extra={t("users.passwordHint")}>
      <Input.Password id="create-password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />
    </Form.Item>
    <Form.Item label={t("users.phoneOptional")} htmlFor="create-phone" {...props("phone")}>
      <Input id="create-phone" type="tel" maxLength={32} value={phone} onChange={(e) => setPhone(e.target.value)} />
    </Form.Item>
    <ErrorText error={formLevel(error)} />
    <Button type="primary" htmlType="submit" loading={submit.pending}>{t("users.createSubmit")}</Button>
  </Form>;
}
