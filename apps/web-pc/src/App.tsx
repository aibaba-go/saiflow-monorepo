import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Result } from "antd";
import { useEffect } from "react";
import { createBrowserRouter, Navigate, Route, RouterProvider, Routes } from "react-router-dom";

import { AppConfig } from "./AppConfig";
import { ImpersonatePage } from "./auth/ImpersonatePage";
import { RequireUser } from "./auth/RequireUser";
import { RequireVisitor } from "./auth/RequireVisitor";
import { forgetSession, ME_KEY, type Me, useSessionNotice } from "./auth/session";
import { useT } from "./i18n";
import { AppLayout } from "./layout/AppLayout";
import { ApplyOrgPage } from "./pages/ApplyOrgPage";
import { DocumentPage } from "./pages/DocumentPage";
import { HealthPage } from "./pages/HealthPage";
import { HomeRoute } from "./pages/HomePage";
import { LibraryPage } from "./pages/LibraryPage";
import { OrgGate } from "./pages/OrgGate";
import { OrgPage } from "./pages/OrgPage";
import { ProfilePage } from "./pages/ProfilePage";
import { LoginPage } from "./pages/LoginPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { PlansPage } from "./pages/PlansPage";
import { RegisterGuidePage } from "./pages/RegisterGuidePage";
import { ResetPasswordPage } from "./pages/ResetPasswordPage";
import { ReportBrowserPage } from "./pages/ReportBrowserPage";
import { ReportDesignPage } from "./pages/ReportDesignPage";
import { ReportsPage } from "./pages/ReportsPage";
import { ReportViewPage } from "./pages/ReportViewPage";
import { ReviewDetailPage } from "./pages/ReviewDetailPage";
import { ReviewSettingsPage } from "./pages/ReviewSettingsPage";
import { ReviewsPage } from "./pages/ReviewsPage";
import { RolesPage } from "./pages/RolesPage";
import { TemplateDetailPage, TemplateNewPage } from "./pages/TemplateEditPage";
import { TemplateSamplePage } from "./pages/TemplateSamplePage";
import { TemplatesPage } from "./pages/TemplatesPage";
import { UploadPage } from "./pages/UploadPage";
import { VerifyPage } from "./pages/VerifyPage";
import { setTenantGoneHandler, setUnauthenticatedHandler } from "./services/api";
import { refreshTenants } from "./tenants/useCurrentTenant";
import { useLanguage } from "./stores/language";

/** Any 401 outside login: forget who was signed in. A user's page then goes to
 * /login?next= (090-04); a guest gets a new guest session from RequireVisitor (090-10). */
function SessionWatcher() {
  const queryClient = useQueryClient();
  const setExpired = useSessionNotice((s) => s.setExpired);
  const { message } = AntApp.useApp();
  const t = useT();
  useEffect(() => {
    setUnauthenticatedHandler(() => {
      const before = queryClient.getQueryData<Me | null>(ME_KEY);
      if (before?.kind === "guest") void message.warning(t("err.guest_expired"));
      else setExpired(true);
      forgetSession(queryClient);
    });
    setTenantGoneHandler(() => void refreshTenants(queryClient));
    return () => {
      setUnauthenticatedHandler(() => {});
      setTenantGoneHandler(() => {});
    };
  }, [queryClient, setExpired, message, t]);
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
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/impersonate" element={<ImpersonatePage />} />
          <Route path="/register" element={<RegisterGuidePage />} />
          <Route path="/health" element={<HealthPage />} />
          <Route element={<RequireVisitor />}>
            {/* one layout for guest and user pages, so moving between them keeps it */}
            <Route element={<AppLayout />}>
              <Route path="/" element={<HomeRoute />} />
              <Route path="/upload" element={<UploadPage />} />
              <Route path="/verify" element={<VerifyPage />} />
              <Route path="/verify/:id" element={<VerifyPage />} />
              <Route element={<RequireUser />}>
                <Route path="/org" element={<OrgGate><OrgPage /></OrgGate>} />
                <Route path="/org/apply" element={<ApplyOrgPage />} />
                <Route path="/roles" element={<OrgGate><RolesPage /></OrgGate>} />
                <Route path="/reviews" element={<ReviewsPage />} />
                <Route path="/reviews/:id" element={<ReviewDetailPage />} />
                <Route path="/review-settings" element={<ReviewSettingsPage />} />
                <Route path="/templates" element={<TemplatesPage />} />
                <Route path="/templates/new" element={<TemplateNewPage />} />
                <Route path="/templates/samples/:id" element={<TemplateSamplePage />} />
                <Route path="/templates/:id" element={<TemplateDetailPage />} />
                <Route path="/reports" element={<ReportsPage />} />
                <Route path="/reports/:id/design" element={<ReportDesignPage />} />
                <Route path="/reports/:id" element={<ReportViewPage />} />
                <Route path="/report-view" element={<ReportBrowserPage />} />
                <Route path="/report-view/:id" element={<ReportViewPage />} />
                <Route path="/plans" element={<PlansPage />} />
                <Route path="/notifications" element={<NotificationsPage />} />
                <Route path="/profile" element={<ProfilePage />} />
                <Route path="/library" element={<LibraryPage />} />
                <Route path="/documents/:id" element={<DocumentPage />} />
                <Route path="/data" element={<Navigate to="/library" replace />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Route>
          </Route>
        </Routes>
      </AntApp>
    </AppConfig>
  );
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });

// A data router, so pages can block navigation with unsaved edits (FR-SYS-129); the
// routes themselves stay in <AppRoutes>.
const router = createBrowserRouter([{ path: "*", element: <AppRoutes /> }]);

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  );
}
