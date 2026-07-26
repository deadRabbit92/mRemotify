import React, { useEffect, useState } from 'react';
import { ConfigProvider, Spin, theme } from 'antd';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useStore } from './store';
import { apiMe } from './api/client';
import { LoginPage } from './pages/LoginPage';
import { MainLayout } from './components/Layout/MainLayout';
import { ImportExportPage } from './pages/settings/ImportExportPage';
import { ChangePasswordPage } from './pages/settings/ChangePasswordPage';
import { AboutPage } from './pages/settings/AboutPage';

const ACCENT = '#0ea5a0';

const AuthenticatedRoutes: React.FC = () => (
  <Routes>
    <Route path="/settings/import-export" element={<ImportExportPage />} />
    <Route path="/settings/change-password" element={<ChangePasswordPage />} />
    <Route path="/settings/about" element={<AboutPage />} />
    <Route path="/" element={<MainLayout />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>
);

const App: React.FC = () => {
  const token = useStore((s) => s.token);
  const darkMode = useStore((s) => s.darkMode);
  const setAuth = useStore((s) => s.setAuth);

  // The token in localStorage survives its own expiry, so verify it before
  // mounting anything that talks to the API — otherwise a stale token renders
  // the full UI and only then fails, one error toast per request.
  const [verifying, setVerifying] = useState(!!token);

  useEffect(() => {
    const stored = useStore.getState().token;
    if (!stored) return;

    let cancelled = false;
    apiMe()
      .then(({ data }) => {
        // Refresh the cached user while we're here
        if (!cancelled) setAuth(stored, data);
      })
      .catch(() => {
        // A 401 already cleared the session in the response interceptor. Any
        // other failure (backend down) leaves the token alone — the app loads
        // and reports the problem itself.
      })
      .finally(() => {
        if (!cancelled) setVerifying(false);
      });

    return () => {
      cancelled = true;
    };
  }, [setAuth]);

  useEffect(() => {
    document.documentElement.setAttribute('data-theme', darkMode ? 'dark' : 'light');
  }, [darkMode]);

  return (
    <ConfigProvider
      theme={{
        algorithm: darkMode ? theme.darkAlgorithm : theme.defaultAlgorithm,
        token: {
          colorPrimary: ACCENT,
          borderRadius: 5,
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', 'Noto Sans', Helvetica, Arial, sans-serif",
        },
        components: {
          Layout: {
            headerBg: 'var(--mr-bg-topbar)',
            bodyBg: 'var(--mr-bg-body)',
          },
        },
      }}
    >
      <BrowserRouter>
        {verifying ? (
          <div
            style={{
              height: '100vh',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              background: 'var(--mr-bg-body)',
            }}
          >
            <Spin size="large" />
          </div>
        ) : token ? (
          <AuthenticatedRoutes />
        ) : (
          <LoginPage />
        )}
      </BrowserRouter>
    </ConfigProvider>
  );
};

export default App;
