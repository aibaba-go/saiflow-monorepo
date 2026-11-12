import { App, Alert, Button, Form, Input, Typography } from "antd";
import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";

import { AuthShell } from "../auth/AuthShell";
import { checkEmail, checkNewPassword, resetPassword, sendAuthCode, useSignedIn } from "../auth/emailAuth";
import { safeNext } from "../auth/lineLogin";
import { ErrorText } from "../components/ErrorText";
import { fieldErrorText, formLevel, requireFields } from "../components/FieldError";
import { useSubmit } from "../hooks/useSubmit";
import { useT } from "../i18n";
import { EmailCodeButton } from "../profile/EmailCodeButton";

/** Reset the password with an email code, without a session (FR-SYS-155, 151): success
 * logs this browser in and goes on to the page before login; `next` is a page of this site. */
export function ResetPasswordPage() {
  const t = useT();
  const { message } = App.useApp();
  const [params] = useSearchParams();
  const [next] = useState(() => safeNext(params.get("next")));
  const signedIn = useSignedIn();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<unknown>(null);
  const item = (field: string) => {
    const text = fieldErrorText(error, field, t);
    return { validateStatus: text ? ("error" as const) : undefined, help: text };
  };
  const backTo = next === "/" ? "/login" : `/login?next=${encodeURIComponent(next)}`;

  const submit = useSubmit(async () => {
    setError(null);
    const bad =
      checkEmail(email) ?? requireFields({ code }) ?? checkNewPassword(password, confirm, "password", "password_confirm");
    if (bad) return setError(bad);
    try {
      const signed = await resetPassword(email, code, password);
      void message.success(t("login.resetDone"));
      await signedIn(signed, next);
    } catch (err) {
      setError(err);
    }
  });

  return (
    <AuthShell>
      <div className="pc-auth__head">
        <p className="pc-auth__eyebrow">{t("eyebrow.account")}</p>
        <Typography.Title level={3} className="pc-auth__title">
          {t("login.resetTitle")}
        </Typography.Title>
        <Typography.Text type="secondary">{t("login.resetSubtitle")}</Typography.Text>
      </div>
      <Alert type="info" showIcon message={t("login.resetHint")} />
      <Form layout="vertical" requiredMark={false} noValidate className="pc-login-form" onFinish={() => void submit.run()}>
        <ErrorText error={formLevel(error)} />
        <Form.Item label={t("login.email")} htmlFor="reset-email" {...item("email")}>
          <div className="pc-email-row">
            <Input
              id="reset-email"
              type="email"
              size="large"
              autoComplete="email"
              placeholder="name@company.co.th"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
            <EmailCodeButton email={email} onError={setError} size="large" send={(to) => sendAuthCode(to, "reset")} />
          </div>
        </Form.Item>
        <Form.Item label={t("login.code")} htmlFor="reset-code" {...item("code")}>
          <Input
            id="reset-code"
            size="large"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </Form.Item>
        <Form.Item
          label={t("login.newPassword")}
          htmlFor="reset-password"
          extra={fieldErrorText(error, "password", t) ? undefined : t("login.passwordRule")}
          {...item("password")}
        >
          <Input.Password
            id="reset-password"
            size="large"
            autoComplete="new-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Form.Item>
        <Form.Item label={t("login.newPasswordConfirm")} htmlFor="reset-password-confirm" {...item("password_confirm")}>
          <Input.Password
            id="reset-password-confirm"
            size="large"
            autoComplete="new-password"
            value={confirm}
            onChange={(e) => setConfirm(e.target.value)}
          />
        </Form.Item>
        <Button type="primary" size="large" block htmlType="submit" loading={submit.pending}>
          {t("login.resetSubmit")}
        </Button>
        <div className="pc-login-links">
          <Link to={backTo}>{t("login.backToLogin")}</Link>
        </div>
      </Form>
    </AuthShell>
  );
}
