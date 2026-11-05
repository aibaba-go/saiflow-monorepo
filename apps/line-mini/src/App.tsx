import { QueryClient, QueryClientProvider, useQueryClient } from "@tanstack/react-query";
import { Button, Toast } from "antd-mobile";
import { useEffect, useRef } from "react";
import { HashRouter, Route, Routes, useLocation, useNavigate } from "react-router-dom";

import { BrandLoading } from "./components/BrandLoading";
import { ErrorText } from "./components/ErrorText";
import { liffId } from "./config";
import { boot, configureAuth, retryLogout } from "./features/auth/session";
import { useSubmit } from "./hooks/useSubmit";
import { useT } from "./i18n";
import { HealthPage } from "./pages/HealthPage";
import { MyPage } from "./pages/MyPage";
import { realLiff } from "./services/liff";
import type { Liff } from "./services/liffTypes";
import { useSession } from "./stores/session";
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
      <Button color="primary" loading={retry.pending} onClick={() => void retry.run()}>
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
      <Button color="primary" loading={retry.pending} onClick={() => void retry.run()}>
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
    Toast.show({ content: t(notice) });
    useSession.getState().set({ notice: null });
  }, [notice, t]);

  if (status === "booting") return <Splash />;
  if (status === "error") return <BootError />;
  if (status === "locked") return <Locked />;
  return (
    <Routes>
      <Route path="/my" element={<MyPage />} />
      <Route path="/health" element={<HealthPage />} />
      <Route path="*" element={<MyPage />} />
    </Routes>
  );
}

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: 1 } } });

export function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <HashRouter>
        <Shell liff={realLiff(liffId)} search={window.location.search} />
      </HashRouter>
    </QueryClientProvider>
  );
}
