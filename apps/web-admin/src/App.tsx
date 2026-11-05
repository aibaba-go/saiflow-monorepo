import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp, ConfigProvider, Result } from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import { useEffect, type ReactElement } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { RequireAdmin } from "./auth/RequireAdmin";
import { useForgetAdmin } from "./auth/session";
import { Page } from "./components/Page";
import { useT } from "./i18n";
import { AdminLayout, MENU } from "./layout/AdminLayout";
import {
  OrgApplicationsPage,
  PlanApplicationsPage,
  VerificationApplicationsPage,
} from "./pages/ApplicationPages";
import { HealthPage } from "./pages/HealthPage";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";

/** Pages that have landed; the rest of the menu shows a placeholder. */
const PAGES: Record<string, ReactElement> = {
  "/": <HomePage />,
  "/organization-applications": <OrgApplicationsPage />,
  "/verification-applications": <VerificationApplicationsPage />,
  "/plan-applications": <PlanApplicationsPage />,
};
import { setUnauthenticatedHandler } from "./services/api";
import { useLanguage } from "./stores/language";

/** Any 401 outside login: drop the session; RequireAdmin then goes to /login?next= (060-03). */
function SessionWatcher() {
  const forget = useForgetAdmin();
  useEffect(() => {
    setUnauthenticatedHandler(() => forget());
    return () => setUnauthenticatedHandler(() => {});
  }, [forget]);
  return null;
}

/** Placeholder until the page's task lands. */
function Pending({ title }: { title: Parameters<ReturnType<typeof useT>>[0] }) {
  const t = useT();
  return <Page title={t(title)} />;
}

function NotFound() {
  const t = useT();
  return <Result status="404" title={t("common.notFound")} />;
}

export function AppRoutes() {
  const lang = useLanguage((s) => s.lang);
  return (
    <ConfigProvider locale={lang === "zh" ? zhCN : enUS} button={{ autoInsertSpace: false }}>
      <AntApp>
        <SessionWatcher />
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/health" element={<HealthPage />} />
          <Route
            element={
              <RequireAdmin>
                <AdminLayout />
              </RequireAdmin>
            }
          >
            {MENU.map((m) => (
              <Route key={m.path} path={m.path} element={PAGES[m.path] ?? <Pending title={m.label} />} />
            ))}
            <Route path="/password" element={<Pending title="nav.changePassword" />} />
            <Route path="*" element={<NotFound />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
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
