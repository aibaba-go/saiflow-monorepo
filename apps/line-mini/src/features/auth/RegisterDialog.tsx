import { Button, Popup } from "antd-mobile";
import { useState } from "react";

import { ErrorText } from "../../components/ErrorText";
import { Field } from "../../components/Field";
import { formLevel } from "../../components/FieldError";
import { useSubmit } from "../../hooks/useSubmit";
import { useT } from "../../i18n";
import { api, call } from "../../services/api";
import { useSession, type Me } from "../../stores/session";
import { EmailCodeButton } from "../profile/EmailCodeButton";
import { loadIdentity } from "./session";

function RegisterForm({ me }: { me: Me }) {
  const t = useT();
  const [email, setEmail] = useState(me.email_suggestion ?? me.email ?? "");
  const [code, setCode] = useState("");
  const [phone, setPhone] = useState(me.phone ?? "");
  const [name, setName] = useState(me.display_name ?? "");
  const [error, setError] = useState<unknown>(null);

  const submit = useSubmit(async () => {
    setError(null);
    try {
      await call(
        api.POST("/api/v1/me/registration", {
          body: { email, code, display_name: name, phone },
        }),
      );
      await loadIdentity();
      useSession.getState().set({ registerOpen: false });
    } catch (err) {
      setError(err);
    }
  });

  return (
    <div className="form">
      <h2 className="form__title">{t("register.title")}</h2>
      <Field
        id="reg-email"
        label={t("profile.email")}
        value={email}
        onChange={setEmail}
        error={error}
        field="email"
        type="email"
        extra={<EmailCodeButton email={email} onError={setError} />}
      />
      <Field
        id="reg-code"
        label={t("profile.code")}
        value={code}
        onChange={setCode}
        error={error}
        field="code"
      />
      <Field
        id="reg-phone"
        label={t("profile.phoneOptional")}
        value={phone}
        onChange={setPhone}
        error={error}
        field="phone"
        type="tel"
      />
      <Field
        id="reg-name"
        label={t("profile.nickname")}
        value={name}
        onChange={setName}
        error={error}
        field="display_name"
      />
      <ErrorText error={formLevel(error)} />
      <Button block color="primary" loading={submit.pending} onClick={() => void submit.run()}>
        {t("register.submit")}
      </Button>
    </div>
  );
}

/** Registration (FR-SYS-042), shown whenever the session asks for it. Closing keeps the
 * user logged in and unregistered. */
export function RegisterDialog() {
  const t = useT();
  const open = useSession((s) => s.registerOpen);
  const me = useSession((s) => s.me);
  const close = () => useSession.getState().set({ registerOpen: false });
  return (
    <Popup visible={open && !!me} onMaskClick={close} bodyStyle={{ padding: 16 }}>
      <Button size="mini" fill="none" aria-label={t("common.close")} onClick={close}>
        ✕
      </Button>
      {open && me && <RegisterForm me={me} />}
    </Popup>
  );
}
