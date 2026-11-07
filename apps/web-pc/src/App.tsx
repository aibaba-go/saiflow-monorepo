import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { App as AntApp, Result } from "antd";
import { useEffect } from "react";
import { createBrowserRouter, Navigate, Route, RouterProvider, Routes } from "react-router-dom";

import { AppConfig } from "./AppConfig";
import { RequireUser } from "./auth/RequireUser";
import { forgetSession, useSessionNotice } from "./auth/session";
import { useT } from "./i18n";
import { AppLayout } from "./layout/AppLayout";
import { ApplyOrgPage } from "./pages/ApplyOrgPage";
import { DocumentPage } from "./pages/DocumentPage";
import { HealthPage } from "./pages/HealthPage";
import { HomePage } from "./pages/HomePage";
import { LibraryPage } from "./pages/LibraryPage";
import { OrgGate } from "./pages/OrgGate";
import { OrgPage } from "./pages/OrgPage";
import { ProfilePage } from "./pages/ProfilePage";
import { LoginPage } from "./pages/LoginPage";
import { NotificationsPage } from "./pages/NotificationsPage";
import { PlansPage } from "./pages/PlansPage";
import { RegisterGuidePage } from "./pages/RegisterGuidePage";
import { ReviewDetailPage } from "./pages/ReviewDetailPage";
import { ReviewSettingsPage } from "./pages/ReviewSettingsPage";
import { ReviewsPage } from "./pages/ReviewsPage";
import { RolesPage } from "./pages/RolesPage";
import { UploadPage } from "./pages/UploadPage";
import { VerifyPage } from "./pages/VerifyPage";
import { setTenantGoneHandler, setUnauthenticatedHandler } from "./services/api";
import { refreshTenants } from "./tenants/useCurrentTenant";
import { useLanguage } from "./stores/language";

/** Any 401 outside login: forget the user; RequireUser then goes to /login?next= (090-04). */
function SessionWatcher() {
  const queryClient = useQueryClient();
  const setExpired = useSessionNotice((s) => s.setExpired);
  useEffect(() => {
    setUnauthenticatedHandler(() => {
      setExpired(true);
      forgetSession(queryClient);
    });
    setTenantGoneHandler(() => void refreshTenants(queryClient));
    return () => {
      setUnauthenticatedHandler(() => {});
      setTenantGoneHandler(() => {});
    };
  }, [queryClient, setExpired]);
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
          <Route path="/register" element={<RegisterGuidePage />} />
          <Route path="/health" element={<HealthPage />} />
          <Route element={<RequireUser />}>
            <Route element={<AppLayout />}>
              <Route path="/" element={<HomePage />} />
              <Route path="/org" element={<OrgGate><OrgPage /></OrgGate>} />
              <Route path="/org/apply" element={<ApplyOrgPage />} />
              <Route path="/roles" element={<OrgGate><RolesPage /></OrgGate>} />
              <Route path="/reviews" element={<ReviewsPage />} />
              <Route path="/reviews/:id" element={<ReviewDetailPage />} />
              <Route path="/review-settings" element={<ReviewSettingsPage />} />
              <Route path="/upload" element={<UploadPage />} />
              <Route path="/verify" element={<VerifyPage />} />
              <Route path="/verify/:id" element={<VerifyPage />} />
              <Route path="/plans" element={<PlansPage />} />
              <Route path="/notifications" element={<NotificationsPage />} />
              <Route path="/profile" element={<ProfilePage />} />
              <Route path="/library" element={<LibraryPage />} />
              <Route path="/documents/:id" element={<DocumentPage />} />
              <Route path="/data" element={<Navigate to="/library" replace />} />
              <Route path="*" element={<NotFound />} />
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
