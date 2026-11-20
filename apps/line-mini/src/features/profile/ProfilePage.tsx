import { useState } from "react";

import { ErrorText } from "../../components/ErrorText";
import { Field } from "../../components/Field";
import { formLevel } from "../../components/FieldError";
import { useSubmit } from "../../hooks/useSubmit";
import { useT } from "../../i18n";
import { api, call } from "../../services/api";
import { useSession, type Me } from "../../stores/session";
import { reloadIdentity } from "../auth/session";
import { EmailCodeButton } from "./EmailCodeButton";
import { Button } from "../../components/ui/button";
import { BottomSheet } from "../../components/ui/sheet";

function ChangeEmail({ onDone }: { onDone(): void }) {
  const t = useT();
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<unknown>(null);
  const submit = useSubmit(async () => {
    setError(null);
    try {
      await call(api.POST("/api/v1/me/email", { body: { email, code } }));
      await reloadIdentity();
      onDone();
    } catch (err) {
      setError(err);
    }
  });
  return (
    <div className="form">
      <Field
        id="new-email"
        label={t("profile.newEmail")}
        value={email}
        onChange={setEmail}
        error={error}
        field="email"
        type="email"
        extra={<EmailCodeButton email={email} onError={setError} />}
      />
      <Field
        id="new-email-code"
        label={t("profile.code")}
        value={code}
        onChange={setCode}
        error={error}
        field="code"
      />
      <ErrorText error={formLevel(error)} />
      <Button block variant="primary" loading={submit.pending} onClick={() => void submit.run()}>
        {t("common.confirm")}
      </Button>
    </div>
  );
}

function ProfileForm({ me }: { me: Me }) {
  const t = useT();
  const [name, setName] = useState(me.display_name ?? "");
  const [phone, setPhone] = useState(me.phone ?? "");
  const [error, setError] = useState<unknown>(null);
  const [emailOpen, setEmailOpen] = useState(false);
  const save = useSubmit(async () => {
    setError(null);
    try {
      await call(api.PATCH("/api/v1/me", { body: { display_name: name, phone } }));
      await reloadIdentity();
    } catch (err) {
      setError(err);
    }
  });
  return (
    <div className="page">
      <h1 className="page__title">{t("profile.title")}</h1>
      <Field
        id="profile-name"
        label={t("profile.nickname")}
        value={name}
        onChange={setName}
        error={error}
        field="display_name"
      />
      <Field
        id="profile-phone"
        label={t("profile.phoneOptional")}
        value={phone}
        onChange={setPhone}
        error={error}
        field="phone"
        type="tel"
      />
      <ErrorText error={formLevel(error)} />
      <Button block variant="primary" loading={save.pending} onClick={() => void save.run()}>
        {t("common.save")}
      </Button>
      <div className="field">
        <div className="field__label">{t("profile.email")}</div>
        <div>{me.email ?? t("common.notSet")}</div>
        <Button size="sm" onClick={() => setEmailOpen(true)}>
          {t("profile.changeEmail")}
        </Button>
      </div>
      <BottomSheet open={emailOpen} onClose={() => setEmailOpen(false)} label={t("profile.changeEmail")}>
        {emailOpen && <ChangeEmail onDone={() => setEmailOpen(false)} />}
      </BottomSheet>
    </div>
  );
}

/** Profile (FR-SYS-044): nickname, phone (may be cleared) and email change. */
export function ProfilePage() {
  const me = useSession((s) => s.me);
  if (me?.kind !== "user") return null;
  return <ProfileForm me={me} />;
}
