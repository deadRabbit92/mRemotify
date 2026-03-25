import React, { useEffect } from 'react';
import { ConfigProvider, theme } from 'antd';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { useStore } from './store';
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
        {token ? <AuthenticatedRoutes /> : <LoginPage />}
      </BrowserRouter>
    </ConfigProvider>
  );
};

export default App;
