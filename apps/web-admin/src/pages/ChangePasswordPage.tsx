import { Alert, Button, Card, Form, Input, Space } from "antd";
import { useState } from "react";

import { ErrorText } from "../components/ErrorText";
import { fieldErrorText, formLevel, requireFields } from "../components/FieldError";
import { Page } from "../components/Page";
import { useSubmit } from "../hooks/useSubmit";
import { useT } from "../i18n";
import { api, call } from "../services/api";
import { ApiError } from "../services/errors";

const MIN_LENGTH = 12;

/** The signed-in admin changes their own password (FR-SYS-061, FR-SYS-019). The session
 * stays signed in; the backend signs out the admin's other sessions. */
export function ChangePasswordPage() {
  const t = useT();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState<unknown>(null);
  const [mismatch, setMismatch] = useState(false);
  const [changed, setChanged] = useState(false);

  const { run, pending } = useSubmit(async () => {
    try {
      await call(
        api.POST("/api/v1/admin/me/password", { body: { current_password: current, new_password: next } }),
      );
      setCurrent("");
      setNext("");
      setAgain("");
      setChanged(true);
    } catch (e) {
      setError(e);
    }
  });

  function submit() {
    setChanged(false);
    setMismatch(false);
    const missing = requireFields({ current_password: current, new_password: next, confirm: again });
    if (missing) return setError(missing);
    if (next.length < MIN_LENGTH) return setError(new ApiError(400, "validation_error", ["new_password"]));
    setError(null);
    if (next !== again) return setMismatch(true);
    void run();
  }

  const item = (field: string) => {
    const msg = fieldErrorText(error, field, t);
    return { validateStatus: msg ? ("error" as const) : undefined, help: msg };
  };
  const confirmItem = mismatch ? { validateStatus: "error" as const, help: t("password.mismatch") } : item("confirm");

  return (
    <Page name="password" title={t("nav.changePassword")}>
      <Card style={{ maxWidth: 480 }}>
        <Form layout="vertical" onFinish={submit}>
          <Form.Item label={t("password.current")} htmlFor="pw-current" {...item("current_password")}>
            <Input.Password id="pw-current" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} />
          </Form.Item>
          <Form.Item label={t("password.new")} htmlFor="pw-new" extra={t("password.hint")} {...item("new_password")}>
            <Input.Password id="pw-new" autoComplete="new-password" value={next} onChange={(e) => setNext(e.target.value)} />
          </Form.Item>
          <Form.Item label={t("password.confirm")} htmlFor="pw-confirm" {...confirmItem}>
            <Input.Password id="pw-confirm" autoComplete="new-password" value={again} onChange={(e) => setAgain(e.target.value)} />
          </Form.Item>
          <Space direction="vertical" style={{ width: "100%" }}>
            {changed && <Alert type="success" showIcon message={t("password.changed")} />}
            <ErrorText error={formLevel(error)} />
            <Button type="primary" htmlType="submit" loading={pending}>
              {t("password.submit")}
            </Button>
          </Space>
        </Form>
      </Card>
    </Page>
  );
}
