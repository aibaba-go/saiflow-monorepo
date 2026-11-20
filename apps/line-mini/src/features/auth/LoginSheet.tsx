import { KeyRound, Mail, ShieldCheck, X } from "lucide-react";
import { useState } from "react";

import { ErrorText } from "../../components/ErrorText";
import { Field } from "../../components/Field";
import { formLevel, requireFields } from "../../components/FieldError";
import { Button } from "../../components/ui/button";
import { BottomSheet } from "../../components/ui/sheet";
import { useSubmit } from "../../hooks/useSubmit";
import { useT } from "../../i18n";
import { useSession } from "../../stores/session";
import { EmailCodeButton } from "../profile/EmailCodeButton";
import { checkEmail, checkNewPassword } from "./passwordRule";
import {
  closeLogin,
  loginWithEmailCode,
  loginWithLineFromPanel,
  loginWithPassword,
  resetPassword,
  sendAuthEmailCode,
} from "./session";
import s from "./LoginSheet.module.css";

type Method = "password" | "code";

/** The first client-side problem of a form: empty fields, then a malformed email. */
function firstProblem(email: string, values: Record<string, string>): unknown {
  return checkEmail(email) ?? requireFields(values);
}

function LineIcon() {
  return (
    <svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true" focusable="false">
      <path
        fill="currentColor"
        d="M12 3C6.48 3 2 6.6 2 11.04c0 3.98 3.55 7.3 8.35 7.94.33.07.77.22.88.5.1.25.07.65.03.9l-.14.85c-.04.25-.2.98.86.53 1.06-.45 5.73-3.37 7.82-5.78C21.24 14.4 22 12.8 22 11.04 22 6.6 17.52 3 12 3Zm-3.6 10.4H6.42a.53.53 0 0 1-.53-.52V8.93a.53.53 0 0 1 1.06 0v3.42H8.4a.53.53 0 0 1 0 1.05Zm2.05-.52a.53.53 0 0 1-1.06 0V8.93a.53.53 0 0 1 1.06 0v3.95Zm4.76 0a.53.53 0 0 1-.95.32l-2.03-2.76v2.44a.53.53 0 0 1-1.06 0V8.93a.53.53 0 0 1 .95-.32l2.03 2.77V8.93a.53.53 0 0 1 1.06 0v3.95Zm3.2-2.5a.53.53 0 0 1 0 1.06h-1.45v.92h1.45a.53.53 0 0 1 0 1.05h-1.98a.53.53 0 0 1-.53-.52V8.93c0-.29.24-.52.53-.52h1.98a.53.53 0 0 1 0 1.05h-1.45v.92h1.45Z"
      />
    </svg>
  );
}

/** Login view: LINE first, then email with a password or a login code (FR-SYS-153). */
function LoginView({ onForgot }: { onForgot(): void }) {
  const t = useT();
  const lineError = useSession((st) => st.loginError);
  const [method, setMethod] = useState<Method>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<unknown>(null);

  const line = useSubmit(loginWithLineFromPanel);
  const submit = useSubmit(async () => {
    const problem =
      method === "password" ? firstProblem(email, { password }) : firstProblem(email, { code });
    setError(problem);
    if (problem) return;
    try {
      if (method === "password") await loginWithPassword(email.trim(), password);
      else await loginWithEmailCode(email.trim(), code.trim());
    } catch (err) {
      setError(err);
    }
  });

  const choose = (next: Method) => {
    setMethod(next);
    setError(null);
  };

  return (
    <div className={s.view}>
      <Button block variant="primary" className={s.line} loading={line.pending} onClick={() => void line.run()}>
        <LineIcon />
        {t("login.line")}
      </Button>
      <ErrorText error={lineError} />

      <div className={s.divider}>
        <span>{t("login.orEmail")}</span>
      </div>

      <div className={s.switch} role="tablist" aria-label={t("login.method")}>
        <button
          type="button"
          role="tab"
          aria-selected={method === "password"}
          className={s.tab}
          onClick={() => choose("password")}
        >
          <KeyRound size={15} strokeWidth={1.9} aria-hidden="true" />
          {t("login.byPassword")}
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={method === "code"}
          className={s.tab}
          onClick={() => choose("code")}
        >
          <Mail size={15} strokeWidth={1.9} aria-hidden="true" />
          {t("login.byCode")}
        </button>
      </div>

      <form
        className="form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          void submit.run();
        }}
      >
        <ErrorText error={formLevel(error)} />
        <Field
          id="login-email"
          label={t("profile.email")}
          value={email}
          onChange={setEmail}
          error={error}
          field="email"
          type="email"
          extra={
            method === "code" ? (
              <EmailCodeButton
                email={email.trim()}
                onError={setError}
                send={(to) => sendAuthEmailCode(to, "login")}
              />
            ) : undefined
          }
        />
        {method === "password" ? (
          <Field
            id="login-password"
            label={t("login.password")}
            value={password}
            onChange={setPassword}
            error={error}
            field="password"
            type="password"
          />
        ) : (
          <Field
            id="login-code"
            label={t("profile.code")}
            value={code}
            onChange={setCode}
            error={error}
            field="code"
          />
        )}
        <Button block variant="primary" type="submit" loading={submit.pending}>
          {t("login.submit")}
        </Button>
      </form>

      <button type="button" className={s.link} onClick={onForgot}>
        {t("login.forgot")}
      </button>
    </div>
  );
}

/** Reset view in the same panel (FR-SYS-154): a "reset" code, then the new password twice. */
function ResetView({ onBack }: { onBack(): void }) {
  const t = useT();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<unknown>(null);

  const submit = useSubmit(async () => {
    const problem =
      firstProblem(email, { code, password, password_confirm: confirm }) ?? checkNewPassword(password, confirm);
    setError(problem);
    if (problem) return;
    try {
      await resetPassword(email.trim(), code.trim(), password);
    } catch (err) {
      setError(err);
    }
  });

  return (
    <form
      className={`form ${s.view}`}
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        void submit.run();
      }}
    >
      <p className={s.hint}>
        <ShieldCheck size={16} strokeWidth={1.9} aria-hidden="true" />
        {t("login.resetHint")}
      </p>
      <ErrorText error={formLevel(error)} />
      <Field
        id="reset-email"
        label={t("profile.email")}
        value={email}
        onChange={setEmail}
        error={error}
        field="email"
        type="email"
        extra={
          <EmailCodeButton email={email.trim()} onError={setError} send={(to) => sendAuthEmailCode(to, "reset")} />
        }
      />
      <Field id="reset-code" label={t("profile.code")} value={code} onChange={setCode} error={error} field="code" />
      <Field
        id="reset-password"
        label={t("login.newPassword")}
        value={password}
        onChange={setPassword}
        error={error}
        field="password"
        type="password"
      />
      <Field
        id="reset-confirm"
        label={t("login.newPasswordConfirm")}
        value={confirm}
        onChange={setConfirm}
        error={error}
        field="password_confirm"
        type="password"
      />
      <Button block variant="primary" type="submit" loading={submit.pending}>
        {t("login.resetSubmit")}
      </Button>
      <button type="button" className={s.link} onClick={onBack}>
        {t("login.backToLogin")}
      </button>
    </form>
  );
}

/** The panel's content; mounted per opening, so each opening starts at the login view. */
function LoginPanel() {
  const t = useT();
  const [view, setView] = useState<"login" | "reset">("login");
  const title = view === "login" ? t("login.title") : t("login.resetTitle");
  return (
    <>
      <div className={s.head}>
        <span className={s.mark} aria-hidden="true">
          S
        </span>
        <div className={s.titles}>
          <h2 className={s.title}>{title}</h2>
          <p className={s.subtitle}>{view === "login" ? t("login.subtitle") : t("login.resetSubtitle")}</p>
        </div>
        <button type="button" className={s.close} aria-label={t("common.close")} onClick={closeLogin}>
          <X size={18} strokeWidth={1.9} aria-hidden="true" />
        </button>
      </div>
      {view === "login" ? <LoginView onForgot={() => setView("reset")} /> : <ResetView onBack={() => setView("login")} />}
    </>
  );
}

/** The login panel (FR-SYS-153, 154), opened by every action that needs a login. Closing it
 * keeps the identity and the page and cancels the pending action. */
export function LoginSheet() {
  const t = useT();
  const open = useSession((st) => st.loginOpen);
  return (
    <BottomSheet open={open} onClose={closeLogin} label={t("login.title")} className={s.sheet}>
      {open && <LoginPanel />}
    </BottomSheet>
  );
}
