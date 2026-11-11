import { useQueryClient } from "@tanstack/react-query";
import { Alert, Card, Space, Spin, Typography } from "antd";
import { useEffect, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";

import { useT } from "../i18n";
import { LanguageSwitch } from "../layout/LanguageSwitch";
import { api, call } from "../services/api";
import { forgetSession, ME_KEY, useSessionNotice } from "./session";

/** The ticket from the fragment, "" when absent or malformed. */
function ticketOf(hash: string): string {
  try {
    return decodeURIComponent(hash.replace(/^#/, "")).trim();
  } catch {
    return "";
  }
}

/** /impersonate#<ticket>: an administrator's one-time link to act as a user (FR-SYS-147). */
export function ImpersonatePage() {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const setExpired = useSessionNotice((s) => s.setExpired);
  const handled = useRef(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (handled.current) return;
    handled.current = true;
    const ticket = ticketOf(location.hash);
    // The ticket is used once: take it out of the address bar before redeeming it.
    navigate({ pathname: location.pathname, search: location.search }, { replace: true });
    void (async () => {
      if (!ticket) return setFailed(true);
      try {
        const me = await call(api.POST("/api/v1/auth/impersonation", { body: { ticket } }), { own401: true });
        await queryClient.cancelQueries({ queryKey: ME_KEY, exact: true });
        forgetSession(queryClient); // whoever was signed in on this browser is replaced
        queryClient.setQueryData(ME_KEY, me.kind === "user" ? me : null);
        setExpired(false);
        navigate("/", { replace: true });
      } catch {
        setFailed(true);
      }
    })();
  }, [location, navigate, queryClient, setExpired]);

  return (
    <div className="pc-auth">
      <Card style={{ width: 420 }}>
        <Space direction="vertical" size="large" style={{ width: "100%" }}>
          <div style={{ textAlign: "right" }}>
            <LanguageSwitch />
          </div>
          <Typography.Title level={3} className="pc-auth__title">
            {t("app.title")}
          </Typography.Title>
          {failed ? (
            <>
              <Alert role="alert" type="error" showIcon message={t("impersonate.invalid")} />
              <Link to="/login" replace>
                {t("impersonate.toLogin")}
              </Link>
            </>
          ) : (
            <Spin tip={t("impersonate.entering")}>
              <div style={{ height: 48 }} />
            </Spin>
          )}
        </Space>
      </Card>
    </div>
  );
}
