import { Alert, Button, Card, QRCode, Space, Spin, Typography } from "antd";
import { useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";

import { safeNext } from "../auth/lineLogin";
import { useMe } from "../auth/session";
import { LogoutButton } from "../layout/LogoutButton";
import { LanguageSwitch } from "../layout/LanguageSwitch";
import { liffId } from "../config";
import { useSubmit } from "../hooks/useSubmit";
import { useT } from "../i18n";

export const registerLink = () => `https://liff.line.me/${liffId}?entry=register`;

/** Signed in with LINE but not registered: register in the mini app (FR-SYS-091, D2). */
export function RegisterGuidePage() {
  const t = useT();
  const [params] = useSearchParams();
  const me = useMe();
  const [notYet, setNotYet] = useState(false);
  const next = safeNext(params.get("next"));
  const check = useSubmit(async () => {
    setNotYet(false);
    const result = await me.refetch();
    if (result.data && !result.data.registered) setNotYet(true);
  });

  if (me.isPending) return <Spin size="large" style={{ display: "block", margin: "20vh auto" }} />;
  if (!me.data) return <Navigate to={`/login?next=${encodeURIComponent(next)}`} replace />;
  if (me.data.registered) return <Navigate to={next} replace />;

  const link = registerLink();
  return (
    <div className="pc-auth">
      <Card style={{ width: 520 }}>
        <Space direction="vertical" size="large" style={{ width: "100%" }}>
          <Space style={{ width: "100%", justifyContent: "flex-end" }}>
            <LanguageSwitch />
            <LogoutButton />
          </Space>
          <div>
            <p className="pc-auth__eyebrow">{t("eyebrow.account")}</p>
            <Typography.Title level={3} className="pc-auth__title">
              {t("guide.title")}
            </Typography.Title>
          </div>
          <Typography.Paragraph>{t("guide.body")}</Typography.Paragraph>
          <a href={link} target="_blank" rel="noreferrer">
            {t("guide.link")}
          </a>
          <Space direction="vertical" align="center" style={{ width: "100%" }}>
            <Typography.Text type="secondary">{t("guide.scan")}</Typography.Text>
            <div data-testid="register-qr">
              <QRCode type="svg" value={link} />
            </div>
          </Space>
          {notYet && <Alert role="alert" type="warning" showIcon message={t("guide.notYet")} />}
          <Button type="primary" block loading={check.pending} onClick={() => void check.run()}>
            {t("guide.done")}
          </Button>
        </Space>
      </Card>
    </div>
  );
}
