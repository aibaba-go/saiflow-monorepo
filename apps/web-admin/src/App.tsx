import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { App as AntApp, Result } from "antd";
import { useEffect } from "react";
import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";

import { AppConfig } from "./AppConfig";
import { RequireAdmin } from "./auth/RequireAdmin";
import { useForgetAdmin, useSessionNotice } from "./auth/session";
import { useT } from "./i18n";
import { AdminLayout } from "./layout/AdminLayout";
import {
  OrgApplicationsPage,
  PlanApplicationsPage,
  VerificationApplicationsPage,
} from "./pages/ApplicationPages";
import { AuditLogPage } from "./pages/AuditLogPage";
import { DataSourcesPage } from "./pages/DataSourcesPage";
import { ChangePasswordPage } from "./pages/ChangePasswordPage";
import { HealthPage } from "./pages/HealthPage";
import { HomePage } from "./pages/HomePage";
import { LoginPage } from "./pages/LoginPage";
import { OcrSettingsPage } from "./pages/OcrSettingsPage";
import { OrganizationDetailPage } from "./pages/OrganizationDetailPage";
import { OrganizationsPage } from "./pages/OrganizationsPage";
import { PlansPage } from "./pages/PlansPage";
import { ReportDesignPage } from "./pages/ReportDesignPage";
import { ReportsPage } from "./pages/ReportsPage";
import { SettingsPage } from "./pages/SettingsPage";
import { TemplateDetailPage, TemplateNewPage } from "./pages/TemplateEditPage";
import { TemplateSamplePage } from "./pages/TemplateSamplePage";
import { TemplatesPage } from "./pages/TemplatesPage";
import { TenantBillingPage } from "./pages/TenantBillingPage";
import { UsersPage } from "./pages/UsersPage";
import { setUnauthenticatedHandler } from "./services/api";
import { useLanguage } from "./stores/language";

/** Any 401 outside login: drop the session; RequireAdmin then goes to /login?next= (060-03). */
function SessionWatcher() {
  const forget = useForgetAdmin();
  const setExpired = useSessionNotice((s) => s.setExpired);
  useEffect(() => {
    setUnauthenticatedHandler(() => {
      setExpired(true);
      forget();
    });
    return () => setUnauthenticatedHandler(() => {});
  }, [forget, setExpired]);
  return null;
}

function NotFound() {
  const t = useT();
  return <Result status="404" title={t("common.notFound")} />;
}

export function AppRoutes() {
  const lang = useLanguage((s) => s.lang);
  return (
    <AppConfig lang={lang}>
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
            <Route path="/templates" element={<TemplatesPage />} />
            <Route path="/templates/new" element={<TemplateNewPage />} />
            <Route path="/templates/samples/:id" element={<TemplateSamplePage />} />
            <Route path="/templates/:id" element={<TemplateDetailPage />} />
            <Route path="/reports" element={<ReportsPage />} />
            <Route path="/data-sources" element={<DataSourcesPage />} />
            <Route path="/reports/:id" element={<ReportDesignPage />} />
            <Route path="/password" element={<ChangePasswordPage />} />
            <Route path="*" element={<NotFound />} />
          </Route>
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </AntApp>
    </AppConfig>
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
