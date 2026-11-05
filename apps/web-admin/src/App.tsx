import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp, ConfigProvider, Result } from "antd";
import enUS from "antd/locale/en_US";
import zhCN from "antd/locale/zh_CN";
import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { RequireAdmin } from "./auth/RequireAdmin";
import { useForgetAdmin } from "./auth/session";
import { useT } from "./i18n";
import { AdminLayout } from "./layout/AdminLayout";
import {
  OrgApplicationsPage,
  PlanApplicationsPage,
  VerificationApplicationsPage,
} from "./pages/ApplicationPages";
import { AuditLogPage } from "./pages/AuditLogPage";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { HealthPage } from "./pages/HealthPage";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { OcrSettingsPage } from "./pages/OcrSettingsPage";
import { OrganizationDetailPage } from "./pages/OrganizationDetailPage";
import { OrganizationsPage } from "./pages/OrganizationsPage";
import { PlansPage } from "./pages/PlansPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TenantBillingPage } from "./pages/TenantBillingPage";
import { UsersPage } from "./pages/UsersPage";
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
            <Route path="/" element={<HomePage />} />
            <Route path="/organization-applications" element={<OrgApplicationsPage />} />
            <Route path="/organizations" element={<OrganizationsPage />} />
            <Route path="/organizations/:id" element={<OrganizationDetailPage />} />
            <Route path="/verification-applications" element={<VerificationApplicationsPage />} />
            <Route path="/plan-applications" element={<PlanApplicationsPage />} />
            <Route path="/tenants/:id/billing" element={<TenantBillingPage />} />
            <Route path="/plans" element={<PlansPage />} />
            <Route path="/settings" element={<SettingsPage />} />
            <Route path="/users" element={<UsersPage />} />
            <Route path="/audit-log" element={<AuditLogPage />} />
            <Route path="/ocr" element={<OcrSettingsPage />} />
            <Route path="/password" element={<ChangePasswordPage />} />
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
