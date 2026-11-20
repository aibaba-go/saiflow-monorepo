import { BrowserRouter, Navigate, Route, Routes } from 'react-router';
import { App as AntApp, ConfigProvider } from 'antd';
import thTH from 'antd/locale/th_TH';
import enUS from 'antd/locale/en_US';
import zhCN from 'antd/locale/zh_CN';
import { useTranslation } from 'react-i18next';
import type { UiLanguage } from './i18n/locales';
import { ApiClientProvider } from './api/context';
import { AuthProvider } from './auth/AuthContext';
import { RequireAuth, RequirePermission } from './auth/guards';
import AppLayout from './layouts/AppLayout';
import LoginPage from './features/auth/LoginPage';
import HomePage from './features/home/HomePage';
import UploadPage from './features/upload/UploadPage';
import VerificationPage from './features/verification/VerificationPage';
import ReviewPage from './features/verification/ReviewPage';
import BatchEditPage from './features/verification/BatchEditPage';
import EntryArchivingPage from './features/entry/EntryArchivingPage';
import ArchiveBrowserPage from './features/archive/ArchiveBrowserPage';
import SettingsPage from './features/settings/SettingsPage';
import OperationLogPage from './features/settings/OperationLogPage';

const ANT_LOCALES: Record<UiLanguage, typeof thTH> = {
  th: thTH,
  en: enUS,
  zh: zhCN,
};

/** 根组件：AntD locale 随 UI 语言联动（切换即时生效）。 */
export default function App() {
  const { i18n } = useTranslation();
  const language = ((i18n.resolvedLanguage ?? i18n.language) as UiLanguage) ?? 'th';

  return (
    <ConfigProvider locale={ANT_LOCALES[language]}>
      <AntApp>
        <ApiClientProvider>
          <AuthProvider>
            <BrowserRouter>
            <Routes>
              <Route path="/login" element={<LoginPage />} />
              <Route
                element={
                  <RequireAuth>
                    <AppLayout />
                  </RequireAuth>
                }
              >
                <Route path="/" element={<HomePage />} />
                <Route
                  path="/upload"
                  element={
                    <RequirePermission permission="upload">
                      <UploadPage />
                    </RequirePermission>
                  }
                />
                <Route
                  path="/verification"
                  element={
                    <RequirePermission permission="verify">
                      <VerificationPage />
                    </RequirePermission>
                  }
                />
                <Route
                  path="/verification/batch"
                  element={
                    <RequirePermission permission="verify">
                      <BatchEditPage />
                    </RequirePermission>
                  }
                />
                <Route
                  path="/review"
                  element={
                    <RequirePermission permission="review">
                      <ReviewPage />
                    </RequirePermission>
                  }
                />
                <Route
                  path="/entry-archiving"
                  element={
                    <RequirePermission permission="entry">
                      <EntryArchivingPage />
                    </RequirePermission>
                  }
                />
                <Route
                  path="/archive"
                  element={
                    <RequirePermission permission="manage">
                      <ArchiveBrowserPage />
                    </RequirePermission>
                  }
                />
                <Route
                  path="/settings"
                  element={
                    <RequirePermission permission="configure">
                      <SettingsPage />
                    </RequirePermission>
                  }
                />
                <Route
                  path="/settings/operation-log"
                  element={
                    <RequirePermission permission="configure">
                      <OperationLogPage />
                    </RequirePermission>
                  }
                />
              </Route>
              <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>
            </BrowserRouter>
          </AuthProvider>
        </ApiClientProvider>
      </AntApp>
    </ConfigProvider>
  );
}
