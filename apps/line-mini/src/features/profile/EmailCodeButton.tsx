import { useEffect, useState } from "react";

import { useSubmit } from "../../hooks/useSubmit";
import { useT } from "../../i18n";
import { api, call } from "../../services/api";
import { Button } from "../../components/ui/button";

export const RESEND_SECONDS = 60;

export interface EmailCodeButtonProps {
  email: string;
  onError(error: unknown): void;
}

/** "Send code" with a 60 s countdown after each successful send (FR-SYS-042); a new email
 * address can get a code at once. */
export function EmailCodeButton({ email, onError }: EmailCodeButtonProps) {
  const t = useT();
  const [left, setLeft] = useState(0);
  const [sentTo, setSentTo] = useState<string | null>(null);
  const counting = left > 0 && sentTo === email;

  useEffect(() => {
    if (!counting) return;
    const timer = setInterval(() => setLeft((n) => Math.max(n - 1, 0)), 1000);
    return () => clearInterval(timer);
  }, [counting]);

  const send = useSubmit(async () => {
    onError(null);
    try {
      await call(api.POST("/api/v1/me/email-code", { body: { email } }));
      setSentTo(email);
      setLeft(RESEND_SECONDS);
    } catch (error) {
      onError(error);
    }
  });

  return (
    <Button
      size="sm"
      disabled={counting || !email}
      loading={send.pending}
      onClick={() => void send.run()}
    >
      {counting ? t("common.secondsLeft", { n: left }) : t("profile.sendCode")}
    </Button>
  );
}
