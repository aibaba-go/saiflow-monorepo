import { loadChineseFont } from "@saiflow/ui";
import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef } from "react";
import { HashRouter, Navigate, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import { BrandLoading } from "./components/BrandLoading";
import { ErrorText } from "./components/ErrorText";
import { liffId } from "./config";
import { boot, configureAuth, retryLogout } from "./features/auth/session";
import { useSubmit } from "./hooks/useSubmit";
import { useT } from "./i18n";
import { HealthPage } from "./pages/HealthPage";
import { HistoryPage } from "./features/scan/HistoryPage";
import { HomePage } from "./pages/HomePage";
import { MyPage } from "./pages/MyPage";
import { LoginSheet } from "./features/auth/LoginSheet";
import { RegisterDialog } from "./features/auth/RegisterDialog";
import { ProfilePage } from "./features/profile/ProfilePage";
import { ApplyOrgPage } from "./features/orgs/ApplyOrgPage";
import { OrgPage } from "./features/orgs/OrgPage";
import { RolesPage } from "./features/orgs/RolesPage";
import { VerificationPage } from "./features/orgs/VerificationPage";
import { ReportDetailPage } from "./features/reports/ReportDetailPage";
import { ReportListPage } from "./features/reports/ReportListPage";
import { ReviewDetailPage } from "./features/reviews/ReviewDetailPage";
import { ReviewQueuePage } from "./features/reviews/ReviewQueuePage";
import { ReviewSettingsPage } from "./features/reviews/ReviewSettingsPage";
import { InvitePage } from "./features/invite/InvitePage";
import { PlansPage } from "./features/billing/PlansPage";
import { NotificationsPage } from "./features/notifications/NotificationsPage";
import { TabBar } from "./components/TabBar";
import { ConfirmPage } from "./features/scan/ConfirmPage";
import { FinalResultPage } from "./features/scan/FinalResultPage";
import { ProcessingPage } from "./features/scan/ProcessingPage";
import { ResultPage } from "./features/scan/ResultPage";
import { useUsage } from "./features/billing/useUsage";
import { showReportTab } from "./features/tenants/reportTab";
import { useCurrentTenant } from "./features/tenants/useCurrentTenant";
import { appLiff } from "./services/liff";
import type { Liff } from "./services/liffTypes";
import { useLanguage } from "./stores/language";
import { useSession } from "./stores/session";
import { Button } from "./components/ui/button";
import { DialogHost } from "./components/ui/dialogs";
import { AppToaster, showToast } from "./components/ui/toast";
import "./styles/app.css";

export interface ShellProps {
  liff: Liff;
  search: string;
  liffTimeoutMs?: number;
  logoutTimeoutMs?: number;
}

function Splash() {
  const t = useT();
  return <BrandLoading variant="splash" label={t("brand.connecting")} />;
}

function BootError() {
  const t = useT();
  const error = useSession((s) => s.error);
  const retry = useSubmit(boot);
  return (
    <div className="page page--center">
      <ErrorText error={error} />
      <Button variant="primary" loading={retry.pending} onClick={() => void retry.run()}>
        {t("common.retry")}
      </Button>
    </div>
  );
}

function Locked() {
  const t = useT();
  const retry = useSubmit(retryLogout);
  return (
    <div className="page page--center">
      <div role="alert">{t("err.logout_failed")}</div>
      <Button variant="primary" loading={retry.pending} onClick={() => void retry.run()}>
        {t("common.retry")}
      </Button>
    </div>
  );
}

/** Everything inside the router: boot once, then the shell for the current status. */
export function Shell({ liff, search, liffTimeoutMs = 20_000, logoutTimeoutMs = 10_000 }: ShellProps) {
  const t = useT();
  const navigate = useNavigate();
  const location = useLocation();
  const queryClient = useQueryClient();
  const status = useSession((s) => s.status);
  const notice = useSession((s) => s.notice);
  const path = useRef(location.pathname);
  const started = useRef(false);
  const lang = useLanguage((s) => s.lang);

  useEffect(() => {
    if (lang === "zh") void loadChineseFont();
  }, [lang]);

  useEffect(() => {
    path.current = location.pathname;
  }, [location.pathname]);

  useEffect(() => {
    configureAuth({
      liff,
      search,
      liffTimeoutMs,
      logoutTimeoutMs,
      navigate: (to) => navigate(to),
      currentPath: () => path.current,
      onIdentityChange: () => queryClient.clear(),
    });
    if (!started.current) {
      started.current = true;
      void boot();
    }
  }, [liff, search, liffTimeoutMs, logoutTimeoutMs, navigate, queryClient]);

  useEffect(() => {
    if (!notice) return;
    showToast(t(notice));
    useSession.getState().set({ notice: null });
  }, [notice, t]);

  if (status === "booting") return <Splash />;
  if (status === "error") return <BootError />;
  if (status === "locked") return <Locked />;
  return <MainShell />;
}

const TAB_PATHS = new Set(["/", "/history", "/report", "/my"]);

/** The signed-in or guest app: pages plus the bottom navigation on the four tab pages. The
 * report pages need the Report tab's conditions (FR-SYS-056); a report link while they are
 * not met leads home. */
function MainShell() {
  const t = useT();
  const { pathname } = useLocation();
  const { tenant } = useCurrentTenant();
  const usage = useUsage();
  const report = showReportTab(tenant, usage.data);
  return (
    <>
      <Routes>
        <Route path="/" element={<HomePage />} />
        <Route path="/history" element={<HistoryPage />} />
        <Route path="/report" element={report ? <ReportListPage /> : <HomePage />} />
        <Route
          path="/report/:id"
          element={
            report ? (
              <ReportDetailPage />
            ) : tenant?.kind === "organization" && usage.isPending ? (
              <BrandLoading variant="page" label={t("common.loading")} />
            ) : (
              <Navigate to="/" replace />
            )
          }
        />
        <Route path="/my" element={<MyPage />} />
        <Route path="/profile" element={<ProfilePage />} />
        <Route path="/orgs/apply" element={<ApplyOrgPage />} />
        <Route path="/org" element={<OrgPage />} />
        <Route path="/org/roles" element={<RolesPage />} />
        <Route path="/org/verification" element={<VerificationPage />} />
        <Route path="/org/review-settings" element={<ReviewSettingsPage />} />
        <Route path="/reviews" element={<ReviewQueuePage />} />
        <Route path="/reviews/:id" element={<ReviewDetailPage />} />
        <Route path="/invite" element={<InvitePage />} />
        <Route path="/plans" element={<PlansPage />} />
        <Route path="/scan/confirm" element={<ConfirmPage />} />
        <Route path="/scan/jobs/:id/progress" element={<ProcessingPage />} />
        <Route path="/scan/jobs/:id/result" element={<ResultPage />} />
        <Route path="/scan/jobs/:id/final" element={<FinalResultPage />} />
        <Route path="/notifications" element={<NotificationsPage />} />
        <Route path="/health" element={<HealthPage />} />
        {/* Anything else is not a page: e.g. LIFF hands its tokens over in the URL fragment
            (#access_token=...), which the hash router would read as a path. */}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
      {TAB_PATHS.has(pathname) && <TabBar showReport={report} />}
      <LoginSheet />
      <RegisterDialog />
    </>
  );
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <Shell liff={appLiff(liffId)} search={window.location.search} />
      </HashRouter>
      <DialogHost />
      <AppToaster />
    </QueryClientProvider>
  );
}
