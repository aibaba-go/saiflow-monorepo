import { Alert, Button, Form, Input, Segmented, Spin, Typography } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import { Link, Navigate, useSearchParams } from "react-router-dom";

import { AuthShell } from "../auth/AuthShell";
import { devLoginBody } from "../auth/devLogin";
import {
  checkEmail,
  loginWithEmailCode,
  loginWithPassword,
  sendAuthCode,
  useSignedIn,
} from "../auth/emailAuth";
import { safeNext, startLineLogin, takeLoginState } from "../auth/lineLogin";
import { useMe, useSessionNotice } from "../auth/session";
import { ErrorText } from "../components/ErrorText";
import { fieldErrorText, formLevel, requireFields } from "../components/FieldError";
import { useSubmit } from "../hooks/useSubmit";
import { useT, type MessageKey } from "../i18n";
import { devLoginEnabled, redirectUri } from "../config";
import { EmailCodeButton } from "../profile/EmailCodeButton";
import { api, call } from "../services/api";
import { errorMessage } from "../services/errors";

type Outcome = { kind: "idle" } | { kind: "working" } | { kind: "notice"; key: MessageKey } | { kind: "error"; error: unknown };
type Method = "password" | "code";

export function LineIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" fill="currentColor">
      <path d="M12 3C6.48 3 2 6.64 2 11.13c0 4.02 3.56 7.39 8.37 8.03.33.07.77.22.88.5.1.25.07.65.03.9l-.14.86c-.04.25-.2.99.87.54 1.07-.45 5.76-3.39 7.86-5.8C21.31 14.58 22 12.94 22 11.13 22 6.64 17.52 3 12 3Zm-3.6 10.53H6.42a.53.53 0 0 1-.53-.52V9.04a.53.53 0 0 1 1.06 0v3.44h1.45a.53.53 0 0 1 0 1.05Zm2.05-.52a.53.53 0 0 1-1.06 0V9.04a.53.53 0 0 1 1.06 0Zm4.77 0a.53.53 0 0 1-.95.32l-2.03-2.76v2.44a.53.53 0 0 1-1.06 0V9.04a.53.53 0 0 1 .95-.32l2.03 2.77V9.04a.53.53 0 0 1 1.06 0Zm3.2-2.5a.53.53 0 0 1 0 1.05h-1.45v.93h1.45a.53.53 0 0 1 0 1.05h-1.98a.53.53 0 0 1-.53-.52V9.04c0-.29.24-.53.53-.53h1.98a.53.53 0 0 1 0 1.06h-1.45v.94Z" />
    </svg>
  );
}

/** Email + password or email + code (FR-SYS-149, 150 on web-pc, FR-SYS-090): failures stay
 * on this page with what was typed (AC-FR-SYS-090-07). */
function EmailLogin({ next, lineCode }: { next: string; lineCode?: string }) {
  const t = useT();
  const signedIn = useSignedIn();
  const [method, setMethod] = useState<Method>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<unknown>(null);
  const item = (field: string) => {
    const text = fieldErrorText(error, field, t);
    return { validateStatus: text ? ("error" as const) : undefined, help: text };
  };

  const submit = useSubmit(async () => {
    setError(null);
    const secret: Record<string, string> = method === "password" ? { password } : lineCode ? { email_code: code } : { code };
    const bad = checkEmail(email) ?? requireFields(secret);
    if (bad) return setError(bad);
    try {
      const signed = lineCode
        ? await call(api.POST("/api/v1/auth/line-link", { body: {
          code: lineCode, redirect_uri: redirectUri(), email: email.trim(),
          ...(method === "password" ? { password } : { email_code: code.trim() }),
        } }), { own401: true })
        : method === "password" ? await loginWithPassword(email, password) : await loginWithEmailCode(email, code);
      await signedIn(signed, next);
    } catch (err) {
      setError(err);
    }
  });

  const switchTo = (m: Method) => {
    setMethod(m);
    setError(null);
  };

  return (
    <Form layout="vertical" requiredMark={false} noValidate className="pc-login-form" onFinish={() => void submit.run()}>
      <Segmented<Method>
        block
        aria-label={t("login.method")}
        className="pc-login-switch"
        value={method}
        onChange={switchTo}
        options={[
          { value: "password", label: t("login.byPassword") },
          { value: "code", label: t("login.byCode") },
        ]}
      />
      <ErrorText error={formLevel(error)} />
      <Form.Item label={t("login.email")} htmlFor="login-email" {...item("email")}>
        <div className="pc-email-row">
          <Input
            id="login-email"
            type="email"
            size="large"
            autoComplete="email"
            placeholder="name@company.co.th"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
          {method === "code" && (
            <EmailCodeButton
              email={email}
              onError={setError}
              size="large"
              send={(to) => sendAuthCode(to, "login")}
            />
          )}
        </div>
      </Form.Item>
      {method === "password" ? (
        <Form.Item label={t("login.password")} htmlFor="login-password" {...item("password")}>
          <Input.Password
            id="login-password"
            size="large"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Form.Item>
      ) : (
        <Form.Item label={t("login.code")} htmlFor="login-code" {...item(lineCode ? "email_code" : "code")}>
          <Input
            id="login-code"
            size="large"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={6}
            value={code}
            onChange={(e) => setCode(e.target.value)}
          />
        </Form.Item>
      )}
      <div className="pc-login-links">
        <Link className="pc-login-forgot" to={`/reset-password?next=${encodeURIComponent(next)}`}>
          {t("login.forgot")}
        </Link>
      </div>
      <Button type="primary" size="large" block htmlType="submit" loading={submit.pending}>
        {t(lineCode ? "line.linkSubmit" : "login.submit")}
      </Button>
    </Form>
  );
}

/** The login page and the LINE callback (FR-SYS-090): /login?code&state or ?error&state.
 * LINE, email + password and email + code; "Forgot password" opens /reset-password. */
export function LoginPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const signedIn = useSignedIn();
  const me = useMe();
  const expired = useSessionNotice((s) => s.expired);
  const handled = useRef(false);
  const isCallback = params.has("code") || params.has("error");
  const [outcome, setOutcome] = useState<Outcome>(isCallback ? { kind: "working" } : { kind: "idle" });
  const [next, setNext] = useState(() => safeNext(params.get("next")));
  const [lineCode, setLineCode] = useState<string | null>(null);
  // NFR-DEV-002: only on a local Vite dev server with VITE_DEV_LOGIN=1 (dropped in builds)
  const [devLogin] = useState(() => import.meta.env.DEV && devLoginEnabled());

  /** Exchange a code for a session and go on to `to` (the callback and the dev login). */
  const signIn = useCallback(
    async (body: { code: string; redirect_uri: string }, to: string) => {
      try {
        const signed = await call(api.POST("/api/v1/auth/line", { body }), { own401: true });
        await signedIn(signed, to);
      } catch (error) {
        setOutcome({ kind: "error", error });
      }
    },
    [signedIn],
  );

  useEffect(() => {
    if (!isCallback || handled.current) return;
    handled.current = true;
    const code = params.get("code");
    const failed = params.get("error");
    const saved = takeLoginState(params.get("state"));
    // The callback URL is used once: drop code and state from the address bar first.
    setParams({}, { replace: true });
    void (async () => {
      if (!saved.ok) return setOutcome({ kind: "notice", key: "login.again" });
      setNext(saved.next);
      if (failed || !code) return setOutcome({ kind: "notice", key: "err.line_cancelled" });
      if (saved.mode === "link") {
        setLineCode(code);
        setOutcome({ kind: "idle" });
      } else await signIn({ code, redirect_uri: redirectUri() }, saved.next);
    })();
  }, [isCallback, params, setParams, signIn]);

  const startDevLogin = () => {
    // Constant-false in production builds, so the reserved token is tree-shaken away.
    if (!import.meta.env.DEV) return;
    setOutcome({ kind: "working" });
    void signIn(devLoginBody(), next);
  };

  if (!isCallback && !lineCode && outcome.kind === "idle" && me.data) return <Navigate to={next} replace />;

  const message =
    outcome.kind === "notice"
      ? t(outcome.key)
      : outcome.kind === "error"
        ? errorMessage(outcome.error, t)
        : expired
          ? t("err.session_expired")
          : null;
  const failed = outcome.kind === "notice" || outcome.kind === "error";

  return (
    <AuthShell>
      <div className="pc-auth__head">
        <p className="pc-auth__eyebrow">{t("eyebrow.account")}</p>
        <Typography.Title level={3} className="pc-auth__title">
          {t(lineCode ? "line.bind" : "login.title")}
        </Typography.Title>
        <Typography.Text type="secondary">{t(lineCode ? "line.bindHint" : "login.subtitle")}</Typography.Text>
      </div>
      {message && <Alert role="alert" type={failed ? "error" : "warning"} showIcon message={message} />}
      {outcome.kind === "working" ? (
        <Spin tip={t("login.working")}>
          <div style={{ height: 48 }} />
        </Spin>
      ) : (
        <>
          {lineCode ? (
            <>
              <EmailLogin key="link" next={next} lineCode={lineCode} />
              <Button block style={{ marginTop: 12 }} onClick={() => startLineLogin(next, "link")}>{t("line.retry")}</Button>
              <Link to="/login" onClick={() => setLineCode(null)}>{t("login.backToLogin")}</Link>
            </>
          ) : (
            <>
              <Button size="large" block className="pc-line-button" icon={<LineIcon />} onClick={() => startLineLogin(next)}>
                {failed ? t("common.retry") : t("login.button")}
              </Button>
              <Button block type="link" onClick={() => startLineLogin(next, "link")}>{t("line.bindExisting")}</Button>
              <div className="pc-auth__divider"><span>{t("login.orEmail")}</span></div>
              <EmailLogin key="login" next={next} />
              <p className="pc-auth__note">{t("login.noAccount")}</p>
            </>
          )}
        </>
      )}
      {devLogin && outcome.kind !== "working" && (
        <div className="pc-auth__dev">
          <Button size="large" block danger onClick={startDevLogin}>
            {t("auth.devLogin")}
          </Button>
          <Typography.Text type="secondary">{t("auth.devLoginHint")}</Typography.Text>
        </div>
      )}
    </AuthShell>
  );
}
