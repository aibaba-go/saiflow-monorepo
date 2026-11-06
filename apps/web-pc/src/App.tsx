import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, ConfigProvider, Result, Typography } from "antd";
import enUS from "antd/locale/en_US";
import thTH from "antd/locale/th_TH";
import zhCN from "antd/locale/zh_CN";
import { useEffect } from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";

import { RequireUser } from "./auth/RequireUser";
import { forgetSession, useSessionNotice } from "./auth/session";
import { useT, type MessageKey } from "./i18n";
import { AppLayout } from "./layout/AppLayout";
import { HealthPage } from "./pages/HealthPage";
import { LoginPage } from "./pages/LoginPage";
import { RegisterGuidePage } from "./pages/RegisterGuidePage";
import { setUnauthenticatedHandler } from "./services/api";
import { useLanguage } from "./stores/language";

const LOCALES = { en: enUS, th: thTH, zh: zhCN };

/** Any 401 outside login: forget the user; RequireUser then goes to /login?next= (090-04). */
function SessionWatcher() {
  const queryClient = useQueryClient();
  const setExpired = useSessionNotice((s) => s.setExpired);
  useEffect(() => {
    setUnauthenticatedHandler(() => {
      setExpired(true);
      forgetSession(queryClient);
    });
    return () => setUnauthenticatedHandler(() => {});
  }, [queryClient, setExpired]);
  return null;
}

/** Until each page lands (Tasks 3–5). */
function Placeholder({ name, title }: { name: string; title: MessageKey }) {
  const t = useT();
  return (
    <div data-testid={`page-${name}`}>
      <Typography.Title level={3}>{t(title)}</Typography.Title>
    </div>
  );
}

function NotFound() {
  const t = useT();
  return <Result status="404" title={t("common.notFound")} />;
}

export function AppRoutes() {
  const lang = useLanguage((s) => s.lang);
  return (
    <ConfigProvider locale={LOCALES[lang]} button={{ autoInsertSpace: false }}>
      <AntApp>
        <SessionWatcher />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/register" element={<RegisterGuidePage />} />
          <Route path="/health" element={<HealthPage />} />
          <Route element={<RequireUser />}>
            <Route element={<AppLayout />}>
              <Route path="/" element={<Placeholder name="home" title="nav.home" />} />
              <Route path="/org" element={<Placeholder name="org" title="nav.org" />} />
              <Route path="/roles" element={<Placeholder name="roles" title="nav.roles" />} />
              <Route path="/plans" element={<Placeholder name="plans" title="nav.plans" />} />
              <Route path="/notifications" element={<Placeholder name="notifications" title="nav.notifications" />} />
              <Route path="/profile" element={<Placeholder name="profile" title="nav.profile" />} />
              <Route path="/data" element={<Placeholder name="data" title="nav.data" />} />
              <Route path="*" element={<NotFound />} />
            </Route>
          </Route>
        </Routes>
      </AntApp>
    </ConfigProvider>
  );
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </QueryClientProvider>
  );
}
