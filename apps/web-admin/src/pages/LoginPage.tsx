import { useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Form, Input, Space } from "antd";
import { useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";

import { ADMIN_KEY, safeNext, useAdmin, useSessionNotice, type Admin } from "../auth/session";
import { ErrorText } from "../components/ErrorText";
import { fieldErrorText, formLevel, requireFields } from "../components/FieldError";
import { LanguageSwitch } from "../layout/LanguageSwitch";
import { useSubmit } from "../hooks/useSubmit";
import { useT } from "../i18n";
import { api, call } from "../services/api";

/** Admin login (FR-SYS-060-01/02); afterwards back to ?next= when it is an in-app path. */
export function LoginPage() {
  const t = useT();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [params] = useSearchParams();
  const admin = useAdmin();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<unknown>(null);
  const next = safeNext(params.get("next"));
  const expired = useSessionNotice((s) => s.expired);
  const setExpired = useSessionNotice((s) => s.setExpired);

  const { run, pending } = useSubmit(async () => {
    const missing = requireFields({ username, password });
    if (missing) return setError(missing);
    setError(null);
    try {
      const me = await call<Admin>(
        api.POST("/api/v1/admin/auth/login", { body: { username, password } }),
        { own401: true },
      );
      setExpired(false);
      queryClient.setQueryData(ADMIN_KEY, me);
      navigate(next, { replace: true });
    } catch (e) {
      setPassword("");
      setError(e);
    }
  });

  if (admin.data) return <Navigate to={next} replace />;

  return (
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", padding: 16 }}>
      <Card title={t("login.title")} extra={<LanguageSwitch />} style={{ width: "100%", maxWidth: 380 }}>
        {expired && (
          <Alert type="warning" showIcon message={t("err.unauthenticated")} style={{ marginBottom: 16 }} />
        )}
        <Form layout="vertical" onFinish={() => void run()}>
          <Form.Item
            label={t("login.username")}
            htmlFor="login-username"
            validateStatus={fieldErrorText(error, "username", t) ? "error" : undefined}
            help={fieldErrorText(error, "username", t)}
          >
            <Input
              id="login-username"
              autoComplete="username"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
            />
          </Form.Item>
          <Form.Item
            label={t("login.password")}
            htmlFor="login-password"
            validateStatus={fieldErrorText(error, "password", t) ? "error" : undefined}
            help={fieldErrorText(error, "password", t)}
          >
            <Input.Password
              id="login-password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </Form.Item>
          <Space direction="vertical" style={{ width: "100%" }}>
            <ErrorText error={formLevel(error)} />
            <Button type="primary" htmlType="submit" block loading={pending}>
              {t("login.submit")}
            </Button>
          </Space>
        </Form>
      </Card>
    </div>
  );
}
