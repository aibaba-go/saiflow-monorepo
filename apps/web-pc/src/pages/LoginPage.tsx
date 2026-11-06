import { useQueryClient } from "@tanstack/react-query";
import { Alert, Button, Card, Space, Spin, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useSearchParams } from "react-router-dom";

import { safeNext, startLineLogin, takeLoginState } from "../auth/lineLogin";
import { forgetSession, ME_KEY, useMe, useSessionNotice } from "../auth/session";
import { useT, type MessageKey } from "../i18n";
import { LanguageSwitch } from "../layout/LanguageSwitch";
import { redirectUri } from "../config";
import { api, call } from "../services/api";
import { errorMessage } from "../services/errors";

type Outcome = { kind: "idle" } | { kind: "working" } | { kind: "notice"; key: MessageKey } | { kind: "error"; error: unknown };

/** The login page and the LINE callback (FR-SYS-090): /login?code&state or ?error&state. */
export function LoginPage() {
  const t = useT();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const me = useMe();
  const expired = useSessionNotice((s) => s.expired);
  const setExpired = useSessionNotice((s) => s.setExpired);
  const handled = useRef(false);
  const isCallback = params.has("code") || params.has("error");
  const [outcome, setOutcome] = useState<Outcome>(isCallback ? { kind: "working" } : { kind: "idle" });
  const [next, setNext] = useState(() => safeNext(params.get("next")));

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
      try {
        const signed = await call(
          api.POST("/api/v1/auth/line", { body: { code, redirect_uri: redirectUri() } }),
          { own401: true },
        );
        // A new user may be signing in on this browser: nothing of the previous one stays.
        // An earlier GET /me (no session yet) must not land after this and undo it.
        await queryClient.cancelQueries({ queryKey: ME_KEY, exact: true });
        forgetSession(queryClient); // each user's stored tenant stays (AC-090-04)
        queryClient.setQueryData(ME_KEY, signed.kind === "user" ? signed : null);
        setExpired(false);
        navigate(saved.next, { replace: true });
      } catch (error) {
        setOutcome({ kind: "error", error });
      }
    })();
  }, [isCallback, params, setParams, navigate, queryClient, setExpired]);

  if (!isCallback && outcome.kind === "idle" && me.data) return <Navigate to={next} replace />;

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
    <div style={{ minHeight: "100vh", display: "grid", placeItems: "center", background: "#f5f7fa" }}>
      <Card style={{ width: 420 }}>
        <Space direction="vertical" size="large" style={{ width: "100%" }}>
          <div style={{ textAlign: "right" }}>
            <LanguageSwitch />
          </div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {t("login.title")}
          </Typography.Title>
          <Typography.Text type="secondary">{t("login.subtitle")}</Typography.Text>
          {message && <Alert role="alert" type={failed ? "error" : "warning"} showIcon message={message} />}
          {outcome.kind === "working" ? (
            <Spin tip={t("login.working")}>
              <div style={{ height: 48 }} />
            </Spin>
          ) : (
            <Button type="primary" size="large" block onClick={() => startLineLogin(next)}>
              {failed ? t("common.retry") : t("login.button")}
            </Button>
          )}
        </Space>
      </Card>
    </div>
  );
}
